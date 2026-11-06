/**
 * Built-in mailbox on Cloudflare Email Routing (receive) + send_email (send).
 *
 * Inbound mail is stored as a row with decoded bodies (capped) and its
 * attachments in R2; outbound mail (composed in the app or sent by the system)
 * is recorded in the SENT folder. HTML bodies are only ever served through
 * /api/mail/:id/html with a script-free sandbox CSP.
 */
import type { Env } from '../config/env';
import { all, one, run } from '../db/client';
import { getGroup } from '../db/repositories/settings-repo';
import { AppError } from '../lib/errors';
import { newId } from '../lib/ids';
import { sha256Hex } from '../lib/crypto';
import { bodiesOf, htmlToText, parseAddress, type ParsedEmail } from '../email/mime';
import { addressList, resolveBaseProvider, type OutboundAttachment, type OutboundMessage } from './email/sender';
import { audit } from './audit-service';

export const FOLDERS = ['INBOX', 'SENT', 'ARCHIVE', 'TRASH'] as const;
export type Folder = (typeof FOLDERS)[number];

const MAX_TEXT = 200_000;
const MAX_HTML = 400_000;
export const MAX_SEND_BYTES = 20 * 1024 * 1024;

export interface MailRow {
  id: string; folder: Folder; direction: 'IN' | 'OUT'; mailbox: string | null; message_id: string | null; in_reply_to: string | null;
  thread_id: string; from_email: string | null; from_name: string | null; to_email: string | null; cc_email: string | null;
  subject: string | null; snippet: string | null; text_body: string | null; html_body: string | null; has_attachments: number;
  size_bytes: number; raw_r2_key: string | null; is_read: number; is_starred: number; status: string; error_text: string | null;
  related_type: string | null; related_id: string | null; sent_by: string | null; received_email_id: string | null; created_at: string;
}
export interface AttachmentRow { id: string; mail_id: string; filename: string; mime_type: string; content_id: string | null; size_bytes: number; sha256: string | null; r2_key: string }

const snippetOf = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 180) || null;
const ymPath = () => new Date().toISOString().slice(0, 7).replace('-', '/');

/** Find the thread of a reply via In-Reply-To / References, else start a new one. */
async function threadFor(db: D1Database, ids: string[], fallback: string): Promise<string> {
  const clean = ids.filter(Boolean).slice(-20);
  if (!clean.length) return fallback;
  const hit = await one<{ thread_id: string }>(
    db, `SELECT thread_id FROM mail_messages WHERE message_id IN (${clean.map((_, i) => `?${i + 1}`).join(',')}) LIMIT 1`, ...clean);
  return hit?.thread_id ?? fallback;
}

async function putAttachment(env: Env, mailId: string, a: { filename: string; mime: string; bytes: Uint8Array; contentId?: string | null }): Promise<void> {
  const id = newId('att');
  const key = `mail/${ymPath()}/${mailId}/${id}`;
  await env.ARCHIVE_BUCKET.put(key, a.bytes, { httpMetadata: { contentType: a.mime } });
  await run(env.DB,
    `INSERT INTO mail_attachments (id, mail_id, filename, mime_type, content_id, size_bytes, sha256, r2_key) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`,
    id, mailId, a.filename.slice(0, 255), a.mime, a.contentId ?? null, a.bytes.byteLength, await sha256Hex(a.bytes), key);
}

/** Store an inbound message in the INBOX. Returns the mail id. */
export async function storeInbound(env: Env, input: {
  parsed: ParsedEmail; envelopeFrom: string; envelopeTo: string; size: number; rawKey: string | null; receivedEmailId: string;
}): Promise<string> {
  const { parsed } = input;
  const id = newId('mail');
  const b = bodiesOf(parsed);
  const text = b.text ?? (b.html ? htmlToText(b.html) : '');
  const from = parseAddress(parsed.from);
  const refs = `${parsed.headers['references'] ?? ''} ${parsed.headers['in-reply-to'] ?? ''}`.match(/<[^>]+>/g) ?? [];
  const thread = await threadFor(env.DB, refs, id);
  await run(env.DB,
    `INSERT INTO mail_messages (id, folder, direction, mailbox, message_id, in_reply_to, thread_id, from_email, from_name, to_email, cc_email,
       subject, snippet, text_body, html_body, has_attachments, size_bytes, raw_r2_key, status, received_email_id)
     VALUES (?1,'INBOX','IN',?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,'RECEIVED',?17)`,
    id, input.envelopeTo.toLowerCase(), parsed.messageId, (parsed.headers['in-reply-to'] ?? '').trim() || null, thread,
    from.email ?? input.envelopeFrom.toLowerCase(), from.name, parsed.to ? parsed.to.slice(0, 1000) : input.envelopeTo, parsed.headers['cc']?.slice(0, 1000) ?? null,
    parsed.subject, snippetOf(text), text.slice(0, MAX_TEXT), b.html ? b.html.slice(0, MAX_HTML) : null,
    b.attachments.length ? 1 : 0, input.size, input.rawKey, input.receivedEmailId);
  for (const a of b.attachments) {
    await putAttachment(env, id, { filename: a.filename ?? `attachment.${a.contentType.split('/')[1] ?? 'bin'}`, mime: a.contentType, bytes: a.body, contentId: a.contentId });
  }
  return id;
}

/** Copy of an outbound message (sent or failed) into SENT. */
export async function recordOutbound(env: Env, msg: OutboundMessage, r: {
  messageId?: string; error?: string; actor?: string; related?: { type: string; id: string }; inReplyToMailId?: string;
}): Promise<string> {
  const id = newId('mail');
  const atts = [...(msg.attachment ? [msg.attachment] : []), ...(msg.attachments ?? [])];
  const thread = r.inReplyToMailId
    ? (await one<{ thread_id: string }>(env.DB, `SELECT thread_id FROM mail_messages WHERE id=?1`, r.inReplyToMailId))?.thread_id ?? id
    : await threadFor(env.DB, msg.inReplyTo ? [msg.inReplyTo] : [], id);
  await run(env.DB,
    `INSERT INTO mail_messages (id, folder, direction, mailbox, message_id, in_reply_to, thread_id, from_email, from_name, to_email, cc_email,
       subject, snippet, text_body, html_body, has_attachments, size_bytes, is_read, status, error_text, related_type, related_id, sent_by)
     VALUES (?1,'SENT','OUT',?2,?3,?4,?5,?2,?6,?7,?8,?9,?10,?11,?12,?13,?14,1,?15,?16,?17,?18,?19)`,
    id, msg.from.toLowerCase(), r.messageId ?? null, msg.inReplyTo ?? null, thread, msg.fromName ?? null, msg.to, msg.cc ?? null,
    msg.subject, snippetOf(msg.text), msg.text.slice(0, MAX_TEXT), msg.html?.slice(0, MAX_HTML) ?? null, atts.length ? 1 : 0,
    atts.reduce((n, a) => n + a.bytes.byteLength, msg.text.length), r.error ? 'FAILED' : 'SENT', r.error ?? null,
    r.related?.type ?? null, r.related?.id ?? null, r.actor ?? null);
  for (const a of atts) await putAttachment(env, id, { filename: a.filename, mime: a.mime, bytes: a.bytes });
  return id;
}

export interface MailSettings {
  domain: string; addresses: string[]; invoiceAddresses: string[]; forwardTo: string | null;
  fromEmail: string; fromName: string; replyTo: string | null; signature: string;
}

export async function mailSettings(db: D1Database): Promise<MailSettings> {
  const [inb, out] = await Promise.all([getGroup(db, 'EMAIL_INBOUND'), getGroup(db, 'EMAIL_OUTBOUND')]);
  const fromEmail = String(out.from_email ?? '').trim().toLowerCase();
  return {
    domain: String(inb.mail_domain ?? fromEmail.split('@')[1] ?? '').trim().toLowerCase(),
    addresses: addressList(String(inb.addresses ?? '')).map((a) => a.toLowerCase()),
    invoiceAddresses: addressList(String(inb.invoice_addresses ?? '')).map((a) => a.toLowerCase()),
    forwardTo: String(inb.forward_to ?? '').trim() || null,
    fromEmail, fromName: String(out.from_name ?? ''), replyTo: String(out.reply_to ?? '').trim() || null, signature: String(out.signature ?? ''),
  };
}

/** Addresses the app may send from: the default sender plus the configured mailboxes. */
export function senderAddresses(s: MailSettings): string[] {
  return [...new Set([s.fromEmail, ...s.addresses].filter(Boolean))];
}

export interface ComposeInput {
  from?: string; to: string; cc?: string; bcc?: string; subject: string; text: string;
  attachments?: { filename: string; mime: string; data: string }[];
  reply_to_id?: string; forward_id?: string;
}

/** Send a message composed in the app and record it in SENT. */
export async function sendMail(env: Env, input: ComposeInput, actor: string): Promise<{ id: string; status: string; error?: string }> {
  const s = await mailSettings(env.DB);
  const allowed = senderAddresses(s);
  const from = (input.from || s.fromEmail).toLowerCase();
  if (!from) throw new AppError('CONFLICT', 'outbound From email not configured');
  if (!allowed.includes(from)) throw new AppError('VALIDATION_ERROR', 'sender not allowed', { from: 'not_allowed' });

  const attachments: OutboundAttachment[] = (input.attachments ?? []).map((a) => {
    const bin = atob(a.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { filename: a.filename, mime: a.mime || 'application/octet-stream', bytes };
  });

  let inReplyTo: string | undefined;
  let references: string | undefined;
  if (input.reply_to_id) {
    const orig = await one<{ message_id: string | null; in_reply_to: string | null }>(env.DB, `SELECT message_id, in_reply_to FROM mail_messages WHERE id=?1`, input.reply_to_id);
    inReplyTo = orig?.message_id ?? undefined;
    references = orig?.in_reply_to ?? undefined;
  }
  // Forward: re-attach the original attachments.
  if (input.forward_id) {
    for (const a of await attachmentsOf(env.DB, input.forward_id)) {
      const obj = await env.ARCHIVE_BUCKET.get(a.r2_key);
      if (obj) attachments.push({ filename: a.filename, mime: a.mime_type, bytes: new Uint8Array(await obj.arrayBuffer()) });
    }
  }
  const total = attachments.reduce((n, a) => n + a.bytes.byteLength, input.text.length);
  if (total > MAX_SEND_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', 'message too large');

  const msg: OutboundMessage = {
    from, fromName: s.fromName || undefined, to: input.to, subject: input.subject,
    text: s.signature && !input.text.includes(s.signature) ? `${input.text}\n\n-- \n${s.signature}` : input.text,
    ...(input.cc ? { cc: input.cc } : {}), ...(input.bcc ? { bcc: input.bcc } : {}),
    ...(s.replyTo ? { replyTo: s.replyTo } : {}), ...(attachments.length ? { attachments } : {}),
    ...(inReplyTo ? { inReplyTo } : {}), ...(references ? { references } : {}),
  };
  const provider = await resolveBaseProvider(env);
  try {
    const res = await provider.send(env, msg);
    const id = await recordOutbound(env, msg, { messageId: res.messageId, actor, inReplyToMailId: input.reply_to_id });
    await audit(env.DB, { entityType: 'mail', entityId: id, eventType: 'MAIL_SENT', actorEmail: actor, metadata: { to: input.to } });
    return { id, status: 'SENT' };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const id = await recordOutbound(env, msg, { error: detail, actor, inReplyToMailId: input.reply_to_id });
    return { id, status: 'FAILED', error: detail };
  }
}

export async function attachmentsOf(db: D1Database, mailId: string): Promise<AttachmentRow[]> {
  return all<AttachmentRow>(db, `SELECT * FROM mail_attachments WHERE mail_id=?1 ORDER BY created_at`, mailId);
}

const LIST_COLS = `id, folder, direction, mailbox, thread_id, from_email, from_name, to_email, subject, snippet, has_attachments,
  is_read, is_starred, status, related_type, related_id, created_at`;

export async function listMail(db: D1Database, f: { folder: Folder | 'STARRED'; q?: string; limit: number; offset: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.folder === 'STARRED') where.push(`is_starred = 1 AND folder != 'TRASH'`);
  else { params.push(f.folder); where.push(`folder = ?${params.length}`); }
  if (f.q) {
    params.push(`%${f.q.toLowerCase()}%`);
    const p = `?${params.length}`;
    where.push(`(lower(coalesce(subject,'')) LIKE ${p} OR lower(coalesce(from_email,'')) LIKE ${p} OR lower(coalesce(from_name,'')) LIKE ${p}
      OR lower(coalesce(to_email,'')) LIKE ${p} OR lower(coalesce(snippet,'')) LIKE ${p})`);
  }
  const sql = `FROM mail_messages WHERE ${where.join(' AND ')}`;
  const [rows, total] = await Promise.all([
    all<Omit<MailRow, 'text_body' | 'html_body'>>(db, `SELECT ${LIST_COLS} ${sql} ORDER BY created_at DESC LIMIT ${f.limit} OFFSET ${f.offset}`, ...params),
    one<{ n: number }>(db, `SELECT count(*) n ${sql}`, ...params),
  ]);
  return { rows, total: total?.n ?? 0 };
}

export async function mailCounts(db: D1Database) {
  const rows = await all<{ folder: string; n: number; unread: number }>(db,
    `SELECT folder, count(*) n, sum(CASE WHEN is_read=0 THEN 1 ELSE 0 END) unread FROM mail_messages GROUP BY folder`);
  const starred = await one<{ n: number }>(db, `SELECT count(*) n FROM mail_messages WHERE is_starred=1 AND folder != 'TRASH'`);
  return { folders: Object.fromEntries(rows.map((r) => [r.folder, { total: r.n, unread: r.unread ?? 0 }])), starred: starred?.n ?? 0 };
}

export async function getMail(db: D1Database, id: string): Promise<MailRow> {
  const m = await one<MailRow>(db, `SELECT * FROM mail_messages WHERE id=?1`, id);
  if (!m) throw new AppError('NOT_FOUND');
  return m;
}

/** Remove a message for good (only from TRASH): row, attachments and R2 objects. The raw .eml archive is kept. */
export async function purgeMail(env: Env, id: string): Promise<void> {
  const atts = await attachmentsOf(env.DB, id);
  for (const a of atts) await env.ARCHIVE_BUCKET.delete(a.r2_key);
  await run(env.DB, `DELETE FROM mail_attachments WHERE mail_id=?1`, id);
  await run(env.DB, `DELETE FROM mail_messages WHERE id=?1`, id);
}

/** DNS checks for the mail domain via DNS-over-HTTPS (no API token needed). */
export async function mailStatus(env: Env) {
  const s = await mailSettings(env.DB);
  const dns = async (name: string, type: string): Promise<string[]> => {
    try {
      const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
      const j = await r.json() as { Answer?: { data: string }[] };
      return (j.Answer ?? []).map((a) => a.data.replace(/^"|"$/g, '').replace(/" "/g, ''));
    } catch { return []; }
  };
  const [mx, txt, dkim, last] = await Promise.all([
    s.domain ? dns(s.domain, 'MX') : Promise.resolve([]),
    s.domain ? dns(s.domain, 'TXT') : Promise.resolve([]),
    s.domain ? dns(`cf2024-1._domainkey.${s.domain}`, 'TXT') : Promise.resolve([]),
    one<{ inbound: string | null; outbound: string | null; failed: number }>(env.DB,
      `SELECT max(CASE WHEN direction='IN' THEN created_at END) inbound, max(CASE WHEN direction='OUT' AND status='SENT' THEN created_at END) outbound,
              sum(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) failed FROM mail_messages`),
  ]);
  const spf = txt.find((t) => t.startsWith('v=spf1')) ?? null;
  return {
    domain: s.domain || null,
    sendBinding: !!env.EMAIL,
    mx: { ok: mx.some((m) => /mx\.cloudflare\.net\.?$/i.test(m)), records: mx },
    spf: { ok: !!spf && spf.includes('_spf.mx.cloudflare.net'), value: spf },
    dkim: { ok: dkim.some((d) => /p=[A-Za-z0-9+/]{40,}/.test(d)) },
    fromEmail: s.fromEmail || null,
    lastInbound: last?.inbound ?? null, lastOutbound: last?.outbound ?? null, failed: last?.failed ?? 0,
  };
}
