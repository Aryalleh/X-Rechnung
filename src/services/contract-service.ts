/**
 * Contracts: generate from templates, freeze + send a private signing link,
 * customer fills [[fields]] and signs, signed PDF archived immutably in R2.
 *
 * Lifecycle: DRAFT → (send) SENT → (opened) VIEWED → (signed) SIGNED
 *            any non-signed state → CANCELLED
 * Content is frozen at send time (resolved_body + content_hash); a signed
 * contract can never change. The signing link is a random 256-bit token; only
 * its SHA-256 is stored.
 */
import type { Env } from '../config/env';
import { all, one, run } from '../db/client';
import { newId, randomToken } from '../lib/ids';
import { sha256Hex, canonicalJson } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { berlinToday } from '../lib/format';
import {
  missingFields, missingVariables, parseFields, standardVariables, substitute, type FieldDef,
} from '../lib/contract-doc';
import { getActiveSeller } from '../db/repositories/seller-repo';
import { getCustomerById } from '../db/repositories/customer-repo';
import { getDocument } from '../db/repositories/document-repo';
import { getGroup } from '../db/repositories/settings-repo';
import { snapshotSeller } from './seller-service';
import { snapshotCustomer } from './customer-service';
import { getInvoiceSettings } from './settings-service';
import { storeImmutable, fetchObject } from './archive-service';
import { audit } from './audit-service';
import { generatePdf } from './pdf/renderer';
import { renderContractHtml } from './pdf/contract-template';
import { resolveProvider } from './email/sender';

export type ContractLang = 'de' | 'en' | 'fa';
export type ContractStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'CUSTOMER_SIGNED' | 'SIGNED' | 'CANCELLED';

export interface ContractRow {
  id: string; contract_number: string; title: string; language: ContractLang; template_id: string | null;
  customer_id: string | null; customer_snapshot_json: string | null; seller_snapshot_json: string | null;
  body: string; variables_json: string; resolved_body: string | null; content_hash: string | null;
  status: ContractStatus; sign_token_hash: string | null; sign_token_expires_at: string | null;
  seller_signer_name: string | null; seller_signature: string | null; seller_signed_at: string | null;
  field_values_json: string | null; signer_name: string | null; signer_email: string | null; signature: string | null;
  signed_at: string | null; signer_ip: string | null; signer_user_agent: string | null; viewed_at: string | null;
  viewer_ip: string | null; sent_at: string | null; sent_to_email: string | null; signed_pdf_document_id: string | null;
  created_by: string | null; created_at: string; updated_at: string;
}

const LINK_DAYS = 30;          // unsigned link validity
const SIGNED_ACCESS_DAYS = 90; // signer may download the signed PDF for this long
const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
const PNG_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const MAX_SIGNATURE_CHARS = 300_000;

const parse = <T>(s: string | null | undefined, fallback: T): T => {
  try { return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
};
const addDaysIso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

export function assertSignature(sig: string | null | undefined, field: string): void {
  if (!sig || !PNG_RE.test(sig) || sig.length > MAX_SIGNATURE_CHARS) {
    throw new AppError('VALIDATION_ERROR', 'invalid signature', { [field]: 'signature_required' });
  }
}

async function nextNumber(db: D1Database): Promise<string> {
  const year = berlinToday().slice(0, 4);
  const row = await one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM contracts WHERE contract_number LIKE ?1`, `VT-${year}-%`);
  return `VT-${year}-${String((row?.n ?? 0) + 1).padStart(4, '0')}`;
}

// ───────────────────────── admin side ─────────────────────────

export function listContracts(db: D1Database) {
  return all(db, `SELECT id, contract_number, title, language, status, customer_id, signer_name, sent_at, sent_to_email, viewed_at, signed_at, seller_signed_at, sign_token_expires_at, created_at, updated_at,
      json_extract(customer_snapshot_json, '$.company_name') AS customer_company, json_extract(customer_snapshot_json, '$.name') AS customer_person
    FROM contracts ORDER BY created_at DESC`);
}

export async function getContract(db: D1Database, id: string): Promise<ContractRow> {
  const c = await one<ContractRow>(db, `SELECT * FROM contracts WHERE id = ?1`, id);
  if (!c) throw new AppError('NOT_FOUND');
  return c;
}

/** Admin view: parsed JSON, no token hash. */
export function contractView(c: ContractRow) {
  const { sign_token_hash: _h, ...rest } = c;
  return {
    ...rest,
    variables: parse<Record<string, string>>(c.variables_json, {}),
    field_values: parse<Record<string, string | boolean>>(c.field_values_json, {}),
    customer: parse<Record<string, unknown>>(c.customer_snapshot_json, {}),
    seller: parse<Record<string, unknown>>(c.seller_snapshot_json, {}),
    link_active: Boolean(c.sign_token_hash) && (c.status === 'SENT' || c.status === 'VIEWED'),
  };
}

export interface ContractInput { title: string; language: ContractLang; template_id?: string | null; customer_id?: string | null; body: string; variables: Record<string, string> }

async function snapshots(db: D1Database, customerId: string | null | undefined) {
  const seller = await getActiveSeller(db);
  const customer = customerId ? await getCustomerById(db, customerId) : null;
  if (customerId && !customer) throw new AppError('VALIDATION_ERROR', 'customer not found', { customer_id: 'not_found' });
  return { seller: seller ? snapshotSeller(seller) : {}, customer: customer ? snapshotCustomer(customer) : null };
}

export async function createContract(db: D1Database, input: ContractInput, actor: string): Promise<ContractRow> {
  const id = newId('ctr');
  const number = await nextNumber(db);
  const snap = await snapshots(db, input.customer_id);
  await run(db, `INSERT INTO contracts (id, contract_number, title, language, template_id, customer_id, customer_snapshot_json, seller_snapshot_json, body, variables_json, created_by)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`,
    id, number, input.title, input.language, input.template_id ?? null, input.customer_id ?? null,
    snap.customer ? JSON.stringify(snap.customer) : null, JSON.stringify(snap.seller), input.body, JSON.stringify(input.variables ?? {}), actor);
  await audit(db, { entityType: 'contract', entityId: id, eventType: 'CONTRACT_CREATED', actorEmail: actor, metadata: { number } });
  return getContract(db, id);
}

export async function updateContract(db: D1Database, id: string, input: ContractInput, actor: string): Promise<ContractRow> {
  const c = await getContract(db, id);
  if (c.status !== 'DRAFT') throw new AppError('CONFLICT', 'only drafts can be edited', { _: 'contract_not_draft' });
  const snap = await snapshots(db, input.customer_id);
  await run(db, `UPDATE contracts SET title=?2, language=?3, template_id=?4, customer_id=?5, customer_snapshot_json=?6, seller_snapshot_json=?7,
      body=?8, variables_json=?9, updated_at=${NOW} WHERE id=?1`,
    id, input.title, input.language, input.template_id ?? null, input.customer_id ?? null,
    snap.customer ? JSON.stringify(snap.customer) : null, JSON.stringify(snap.seller), input.body, JSON.stringify(input.variables ?? {}));
  await audit(db, { entityType: 'contract', entityId: id, eventType: 'CONTRACT_UPDATED', actorEmail: actor });
  return getContract(db, id);
}

export async function deleteDraftContract(db: D1Database, id: string, actor: string): Promise<void> {
  const c = await getContract(db, id);
  if (c.status !== 'DRAFT') throw new AppError('CONFLICT', 'only drafts can be deleted', { _: 'contract_not_draft' });
  await run(db, `DELETE FROM contracts WHERE id=?1`, id);
  await audit(db, { entityType: 'contract', entityId: id, eventType: 'CONTRACT_DELETED', actorEmail: actor });
}

async function newLink(db: D1Database, id: string, origin: string, days = LINK_DAYS): Promise<{ link: string; expiresAt: string }> {
  const token = randomToken(32);
  const expiresAt = addDaysIso(Math.min(Math.max(Math.round(days), 1), 90));
  await run(db, `UPDATE contracts SET sign_token_hash=?2, sign_token_expires_at=?3, updated_at=${NOW} WHERE id=?1`, id, await sha256Hex(token), expiresAt);
  return { link: `${origin}/sign/${token}`, expiresAt };
}

/**
 * Freeze the content (variables substituted, parties snapshotted), create the
 * signing link and optionally e-mail it. The customer signs first; the
 * provider countersigns afterwards (countersignContract).
 */
export async function sendContract(env: Env, id: string, o: {
  email_to?: string | null; message?: string | null; origin: string; link_days?: number;
}, actor: string) {
  const db = env.DB;
  const c = await getContract(db, id);
  if (c.status !== 'DRAFT') throw new AppError('CONFLICT', 'already sent', { _: 'contract_not_draft' });
  if (!c.customer_id) throw new AppError('VALIDATION_ERROR', 'customer required', { customer_id: 'required' });
  // Refresh party snapshots at send time (the frozen version is what gets signed).
  const snap = await snapshots(db, c.customer_id);
  const vars = { ...standardVariables({ seller: snap.seller, customer: snap.customer ?? {}, lang: c.language, number: c.contract_number, title: c.title }), ...parse<Record<string, string>>(c.variables_json, {}) };
  const missing = missingVariables(c.body, vars);
  if (missing.length) throw new AppError('VALIDATION_ERROR', 'variables missing', { variables: `missing_variables:${missing.join(', ')}` });
  const resolved = substitute(c.body, vars);
  const contentHash = await sha256Hex(canonicalJson({
    number: c.contract_number, title: c.title, language: c.language, body: resolved,
    seller: snap.seller, customer: snap.customer,
  }));

  await run(db, `UPDATE contracts SET status='SENT', resolved_body=?2, content_hash=?3, seller_snapshot_json=?4, customer_snapshot_json=?5,
      sent_at=${NOW}, sent_to_email=?6, updated_at=${NOW} WHERE id=?1`,
    id, resolved, contentHash, JSON.stringify(snap.seller), JSON.stringify(snap.customer), o.email_to ?? null);
  const days = o.link_days ?? LINK_DAYS;
  const { link, expiresAt } = await newLink(db, id, o.origin, days);
  await audit(db, { entityType: 'contract', entityId: id, eventType: 'CONTRACT_SENT', actorEmail: actor, metadata: { hash: contentHash, to: o.email_to ?? null, linkDays: days } });

  let emailed = false; let emailError: string | null = null;
  if (o.email_to) {
    try { await emailLink(env, c, o.email_to, link, o.message ?? null, days); emailed = true; }
    catch (e) { emailError = e instanceof Error ? e.message : String(e); }
  }
  return { link, expiresAt, emailed, emailError };
}

/** New signing link (old one stops working). */
export async function relinkContract(env: Env, id: string, origin: string, actor: string) {
  const c = await getContract(env.DB, id);
  if (c.status !== 'SENT' && c.status !== 'VIEWED') throw new AppError('CONFLICT', 'not awaiting signature', { _: 'contract_not_pending' });
  const r = await newLink(env.DB, id, origin);
  await audit(env.DB, { entityType: 'contract', entityId: id, eventType: 'CONTRACT_LINK_RENEWED', actorEmail: actor });
  return r;
}

export async function cancelContract(db: D1Database, id: string, actor: string): Promise<void> {
  const c = await getContract(db, id);
  if (c.status === 'SIGNED') throw new AppError('CONFLICT', 'signed contracts cannot be cancelled', { _: 'contract_signed' });
  if (c.status === 'CANCELLED') return;
  await run(db, `UPDATE contracts SET status='CANCELLED', sign_token_hash=NULL, updated_at=${NOW} WHERE id=?1`, id);
  await audit(db, { entityType: 'contract', entityId: id, eventType: 'CONTRACT_CANCELLED', actorEmail: actor });
}

/** Copy of a sent/cancelled contract back to a new draft (for corrections). */
export async function duplicateContract(db: D1Database, id: string, actor: string): Promise<ContractRow> {
  const c = await getContract(db, id);
  return createContract(db, { title: c.title, language: c.language, template_id: c.template_id, customer_id: c.customer_id, body: c.body, variables: parse(c.variables_json, {}) }, actor);
}

async function emailLink(env: Env, c: ContractRow, to: string, link: string, message: string | null, days = LINK_DAYS): Promise<void> {
  const out = await getGroup(env.DB, 'EMAIL_OUTBOUND');
  const seller = await getActiveSeller(env.DB);
  const from = (out.from_email as string) || seller?.email || '';
  if (!from) throw new Error('outbound e-mail not configured');
  const name = seller?.full_name ?? '';
  const txt = {
    de: { s: `Vertrag zur Unterschrift: ${c.title}`, b: `Guten Tag,\n\nbitte prüfen und unterschreiben Sie den Vertrag „${c.title}“ (${c.contract_number}) online:\n\n${link}\n\nDer Link ist ${days} Tage gültig.\n\nMit freundlichen Grüßen\n${name}` },
    en: { s: `Contract for signature: ${c.title}`, b: `Hello,\n\nplease review and sign the contract "${c.title}" (${c.contract_number}) online:\n\n${link}\n\nThe link is valid for ${days} days.\n\nKind regards\n${name}` },
    fa: { s: `قرارداد برای امضا: ${c.title}`, b: `با سلام،\n\nلطفاً قرارداد «${c.title}» (${c.contract_number}) را از طریق لینک زیر بررسی و امضا کنید:\n\n${link}\n\nاین لینک ${days} روز معتبر است.\n\nبا احترام\n${name}` },
  }[c.language];
  const provider = await resolveProvider(env, { related: { type: 'contract', id: c.id } });
  await provider.send(env, { from, fromName: (out.from_name as string) || name, to, subject: txt.s, text: message ? `${message}\n\n${link}` : txt.b });
}

// ───────────────────────── public signing side ─────────────────────────

async function byToken(db: D1Database, token: string): Promise<ContractRow> {
  if (!token || token.length > 128) throw new AppError('NOT_FOUND');
  const c = await one<ContractRow>(db, `SELECT * FROM contracts WHERE sign_token_hash = ?1`, await sha256Hex(token));
  if (!c || c.status === 'DRAFT' || c.status === 'CANCELLED') throw new AppError('NOT_FOUND', 'link invalid', { _: 'sign_link_invalid' });
  if (c.sign_token_expires_at && Date.parse(c.sign_token_expires_at) < Date.now()) throw new AppError('NOT_FOUND', 'link expired', { _: 'sign_link_expired' });
  return c;
}

/** What the signer sees. Marks the contract VIEWED on first open. */
export async function openForSigning(db: D1Database, token: string, ip: string | null) {
  const c = await byToken(db, token);
  if (c.status === 'SENT') {
    await run(db, `UPDATE contracts SET status='VIEWED', viewed_at=${NOW}, viewer_ip=?2 WHERE id=?1 AND status='SENT'`, c.id, ip);
    await audit(db, { entityType: 'contract', entityId: c.id, eventType: 'CONTRACT_VIEWED', actorEmail: 'signer', metadata: { ip } });
  }
  const customer = parse<Record<string, unknown>>(c.customer_snapshot_json, {});
  const seller = parse<Record<string, unknown>>(c.seller_snapshot_json, {});
  const settings = await getInvoiceSettings(db);
  return {
    contract_number: c.contract_number, title: c.title, language: c.language, status: c.status === 'SENT' ? 'VIEWED' : c.status,
    body: c.resolved_body ?? '', fields: parseFields(c.resolved_body ?? ''), content_hash: c.content_hash,
    seller: { full_name: seller.full_name, business_name: seller.business_name, street: seller.street, postal_code: seller.postal_code, city: seller.city, email: seller.email },
    customer: { company_name: customer.company_name, name: customer.name, street: customer.street, postal_code: customer.postal_code, city: customer.city, email: customer.email },
    seller_signer_name: c.seller_signer_name, seller_signature: c.seller_signature, seller_signed_at: c.seller_signed_at,
    // customer_signed: the customer is done; signed: provider has countersigned too (final PDF available).
    customer_signed: c.status === 'CUSTOMER_SIGNED' || c.status === 'SIGNED', signed: c.status === 'SIGNED',
    signer_name: c.signer_name, signed_at: c.signed_at,
    signature: c.status === 'CUSTOMER_SIGNED' || c.status === 'SIGNED' ? c.signature : null,
    field_values: c.status === 'CUSTOMER_SIGNED' || c.status === 'SIGNED' ? parse(c.field_values_json, {}) : {},
    expires_at: c.status === 'SENT' || c.status === 'VIEWED' ? c.sign_token_expires_at : null,
    accent_color: settings.accent_color, brand: settings.brand_heading || (seller.business_name as string) || (seller.full_name as string) || '',
  };
}

export async function signContract(env: Env, token: string, input: {
  signer_name: string; signer_email?: string | null; signature: string; values: Record<string, string | boolean>; consent: boolean;
}, meta: { ip: string | null; ua: string | null }, waitUntil?: (p: Promise<unknown>) => void) {
  const db = env.DB;
  const c = await byToken(db, token);
  if (c.status === 'SIGNED' || c.status === 'CUSTOMER_SIGNED') throw new AppError('CONFLICT', 'already signed', { _: 'contract_already_signed' });
  if (!input.consent) throw new AppError('VALIDATION_ERROR', 'consent required', { consent: 'consent_required' });
  assertSignature(input.signature, 'signature');
  const fields: FieldDef[] = parseFields(c.resolved_body ?? '');
  // Keep only known fields; normalize types.
  const values: Record<string, string | boolean> = {};
  for (const f of fields) {
    const v = input.values?.[f.key];
    if (f.type === 'checkbox') values[f.key] = v === true || v === 'true';
    else if (v != null && String(v).trim()) values[f.key] = String(v).trim().slice(0, 500);
  }
  const missing = missingFields(fields, values);
  if (missing.length) throw new AppError('VALIDATION_ERROR', 'fields missing', { values: `missing_fields:${missing.join(', ')}` });

  const res = await run(db, `UPDATE contracts SET status='CUSTOMER_SIGNED', field_values_json=?2, signer_name=?3, signer_email=?4, signature=?5,
      signed_at=${NOW}, signer_ip=?6, signer_user_agent=?7, sign_token_expires_at=?8, updated_at=${NOW}
      WHERE id=?1 AND status IN ('SENT','VIEWED')`,
    c.id, JSON.stringify(values), input.signer_name.trim().slice(0, 200), input.signer_email?.trim() || null, input.signature,
    meta.ip, meta.ua?.slice(0, 400) ?? null, addDaysIso(SIGNED_ACCESS_DAYS));
  if (!res.meta.changes) throw new AppError('CONFLICT', 'already signed', { _: 'contract_already_signed' });
  await audit(db, { entityType: 'contract', entityId: c.id, eventType: 'CONTRACT_CUSTOMER_SIGNED', actorEmail: input.signer_email || 'signer', metadata: { ip: meta.ip, hash: c.content_hash } });
  void waitUntil;
  return { signed: true };
}

/**
 * Provider countersigns after the customer. Completes the contract, archives
 * the final PDF and (if outbound e-mail works) sends the customer a fresh
 * download link.
 */
export async function countersignContract(env: Env, id: string, o: {
  seller_signer_name: string; seller_signature: string; origin: string;
}, actor: string, waitUntil?: (p: Promise<unknown>) => void) {
  const db = env.DB;
  const c = await getContract(db, id);
  if (c.status !== 'CUSTOMER_SIGNED') throw new AppError('CONFLICT', 'customer has not signed', { _: 'contract_not_customer_signed' });
  assertSignature(o.seller_signature, 'seller_signature');
  const res = await run(db, `UPDATE contracts SET status='SIGNED', seller_signer_name=?2, seller_signature=?3, seller_signed_at=${NOW}, updated_at=${NOW}
      WHERE id=?1 AND status='CUSTOMER_SIGNED'`, id, o.seller_signer_name.trim().slice(0, 200), o.seller_signature);
  if (!res.meta.changes) throw new AppError('CONFLICT', 'already countersigned', { _: 'contract_signed' });
  await audit(db, { entityType: 'contract', entityId: id, eventType: 'CONTRACT_SIGNED', actorEmail: actor, metadata: { hash: c.content_hash } });

  // New link for the customer's copy (the old token is replaced, valid SIGNED_ACCESS_DAYS).
  let emailed = false; let emailError: string | null = null;
  if (c.signer_email) {
    const token = randomToken(32);
    await run(db, `UPDATE contracts SET sign_token_hash=?2, sign_token_expires_at=?3 WHERE id=?1`, id, await sha256Hex(token), addDaysIso(SIGNED_ACCESS_DAYS));
    try { await emailCompleted(env, c, c.signer_email, `${o.origin}/sign/${token}`); emailed = true; }
    catch (e) { emailError = e instanceof Error ? e.message : String(e); }
  }
  const job = ensureSignedPdf(env, id).catch(() => undefined);
  if (waitUntil) waitUntil(job); else await job;
  return { signed: true, emailed, emailError };
}

async function emailCompleted(env: Env, c: ContractRow, to: string, link: string): Promise<void> {
  const out = await getGroup(env.DB, 'EMAIL_OUTBOUND');
  const seller = await getActiveSeller(env.DB);
  const from = (out.from_email as string) || seller?.email || '';
  if (!from) throw new Error('outbound e-mail not configured');
  const name = seller?.full_name ?? '';
  const txt = {
    de: { s: `Vertrag unterschrieben: ${c.title}`, b: `Guten Tag,\n\nder Vertrag „${c.title}“ (${c.contract_number}) ist jetzt von beiden Seiten unterschrieben. Ihre Kopie als PDF:\n\n${link}\n\nMit freundlichen Grüßen\n${name}` },
    en: { s: `Contract signed: ${c.title}`, b: `Hello,\n\nthe contract "${c.title}" (${c.contract_number}) is now signed by both parties. Your PDF copy:\n\n${link}\n\nKind regards\n${name}` },
    fa: { s: `قرارداد امضا شد: ${c.title}`, b: `با سلام،\n\nقرارداد «${c.title}» (${c.contract_number}) اکنون توسط هر دو طرف امضا شده است. نسخهٔ PDF شما:\n\n${link}\n\nبا احترام\n${name}` },
  }[c.language];
  const provider = await resolveProvider(env, { related: { type: 'contract', id: c.id } });
  await provider.send(env, { from, fromName: (out.from_name as string) || name, to, subject: txt.s, text: txt.b });
}

// ───────────────────────── PDF ─────────────────────────

export async function contractPdfHtml(db: D1Database, c: ContractRow): Promise<string> {
  const settings = await getInvoiceSettings(db);
  const seller = parse<Record<string, unknown>>(c.seller_snapshot_json, {});
  const customer = parse<Record<string, unknown>>(c.customer_snapshot_json, {});
  const body = c.resolved_body ?? substitute(c.body, {
    ...standardVariables({ seller, customer, lang: c.language, number: c.contract_number, title: c.title }), ...parse<Record<string, string>>(c.variables_json, {}),
  });
  return renderContractHtml({
    language: c.language, title: c.title, contractNumber: c.contract_number, resolvedBody: body,
    fieldValues: parse(c.field_values_json, {}), seller, customer,
    sellerSignerName: c.seller_signer_name, sellerSignature: c.seller_signature, sellerSignedAt: c.seller_signed_at,
    signerName: c.signer_name, signerEmail: c.signer_email, signature: c.signature, signedAt: c.signed_at,
    signerIp: c.signer_ip, signerUserAgent: c.signer_user_agent, sentAt: c.sent_at, viewedAt: c.viewed_at,
    contentHash: c.content_hash, contractId: c.id, accentColor: settings.accent_color,
    ...(settings.brand_heading ? { brandHeading: settings.brand_heading } : {}),
    ...(settings.custom_font ? { customFont: settings.custom_font } : {}),
    draft: c.status !== 'SIGNED',
  });
}

/** Signed PDF bytes: from the archive, or rendered + archived now. */
export async function ensureSignedPdf(env: Env, id: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const c = await getContract(env.DB, id);
  if (c.status !== 'SIGNED') throw new AppError('CONFLICT', 'not signed', { _: 'contract_not_signed' });
  const filename = `${c.contract_number}_signed.pdf`;
  if (c.signed_pdf_document_id) {
    const doc = await getDocument(env.DB, c.signed_pdf_document_id);
    const obj = doc ? await fetchObject(env.ARCHIVE_BUCKET, doc.r2_key) : null;
    if (obj) return { bytes: new Uint8Array(await obj.arrayBuffer()), filename };
  }
  const bytes = await generatePdf(env, await contractPdfHtml(env.DB, c));
  const stored = await storeImmutable({
    db: env.DB, bucket: env.ARCHIVE_BUCKET, area: 'contracts', date: (c.signed_at ?? berlinToday()).slice(0, 10),
    entityType: 'contract', entityId: c.id, documentRole: 'signed_pdf', filename, mimeType: 'application/pdf', body: bytes,
  });
  // Only the first archived copy is referenced (concurrent renders keep the earliest).
  await run(env.DB, `UPDATE contracts SET signed_pdf_document_id=?2 WHERE id=?1 AND signed_pdf_document_id IS NULL`, c.id, stored.documentId);
  return { bytes, filename };
}

/** Download by signing token (signer side). */
export async function signedPdfByToken(env: Env, token: string) {
  const c = await byToken(env.DB, token);
  return ensureSignedPdf(env, c.id);
}
