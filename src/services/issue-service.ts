/**
 * Invoice issue pipeline — idempotent finalization.
 *
 * Steps (all failures are retryable; a reserved number is VOIDed and never
 * reused, with the reason written to the audit + job-failure log):
 *   1. Load draft, verify status.
 *   2. Validate mandatory fields; recompute totals in the backend.
 *   3. Build seller + customer snapshots.
 *   4. Canonical JSON + SHA-256 content hash.
 *   5. Reserve invoice number from the Durable Object (idempotent).
 *   6. Status -> ISSUING.
 *   7. Render HTML -> PDF (Browser Run).
 *   8. Store canonical JSON + PDF in R2 (immutable), record SHA-256.
 *   9. Assign number + status ISSUED (D1).
 *  10. Confirm the reserved number.
 *  11. Audit.
 */
import type { Env } from '../config/env';
import { getInvoice, getItems, markIssuing, markIssued, setStatus } from '../db/repositories/invoice-repo';
import { getActiveSeller } from '../db/repositories/seller-repo';
import { getCustomerById } from '../db/repositories/customer-repo';
import { assertSellerIssuable, snapshotSeller } from './seller-service';
import { snapshotCustomer } from './customer-service';
import { assertReadyToIssue, resolveDates } from './invoice-service';
import { computeTotals } from '../lib/money';
import { canonicalJson, sha256Hex } from '../lib/crypto';
import { yearOf } from '../lib/format';
import { reserveNumber, confirmNumber, voidNumber } from './sequence-service';
import { getInvoiceSettings } from './settings-service';
import { PREFIX_BY_TYPE, DEFAULTS } from '../config/constants';
import { renderInvoiceDocument } from './pdf/render';
import { generatePdf } from './pdf/renderer';
import { storeImmutable } from './archive-service';
import { audit } from './audit-service';
import { AppError } from '../lib/errors';
import { newId } from '../lib/ids';
import { run } from '../db/client';
import type { DocumentType } from '../config/constants';

export interface IssueResult {
  invoiceId: string;
  invoiceNumber: string;
  pdfDocumentId: string;
  contentHash: string;
}

export async function issueInvoice(
  env: Env,
  invoiceId: string,
  idempotencyKey: string,
  actorEmail: string,
): Promise<IssueResult> {
  const db = env.DB;
  const invoice = await getInvoice(db, invoiceId);
  if (!invoice) throw new AppError('NOT_FOUND');

  // Idempotency: already issued -> return existing.
  if (invoice.status === 'ISSUED' || invoice.status === 'SENT' || invoice.status === 'PAID' || invoice.status === 'PARTIALLY_PAID') {
    const doc = await import('../db/repositories/document-repo').then((m) => m.findByRole(db, 'invoice', invoiceId, 'pdf'));
    return {
      invoiceId,
      invoiceNumber: invoice.invoice_number ?? '',
      pdfDocumentId: doc?.id ?? '',
      contentHash: invoice.canonical_json_hash ?? '',
    };
  }
  if (invoice.status !== 'DRAFT' && invoice.status !== 'READY_TO_ISSUE' && invoice.status !== 'ISSUING') {
    throw new AppError('CONFLICT', `cannot issue from status ${invoice.status}`);
  }

  const items = await getItems(db, invoiceId);
  await assertReadyToIssue(db, invoice, items);

  const seller = await getActiveSeller(db);
  assertSellerIssuable(seller);
  const customer = await getCustomerById(db, invoice.customer_id!);
  if (!customer) throw new AppError('CUSTOMER_NOT_FOUND');

  // Backend-authoritative recomputation.
  const totals = computeTotals(
    items.map((it) => ({ quantity: it.quantity_decimal, unitPriceCents: it.unit_price_cents, discountCents: it.discount_cents })),
  );

  const settings = await getInvoiceSettings(db);
  const { invoiceDate, dueDate } = await resolveDates(db, invoice);
  const sellerSnapshot = snapshotSeller(seller);
  const customerSnapshot = snapshotCustomer(customer);
  const language = (['fa', 'en', 'de'].includes(invoice.invoice_language) ? invoice.invoice_language : 'de') as 'de' | 'fa' | 'en';
  // The §19 Kleinunternehmer exemption note is shown on German and English EUR
  // invoices (localized). For Persian/Iran invoices the optional note comes from
  // public_note (usually none).
  const EN_19 = 'In accordance with § 19 of the German VAT Act (UStG), no VAT is charged.';
  const taxText = language === 'fa'
    ? (invoice.public_note ?? '')
    : language === 'en'
      ? (invoice.currency === 'EUR' ? EN_19 : (invoice.public_note ?? ''))
      : (settings.tax_exemption_text || seller.tax_exemption_text || DEFAULTS.taxExemptionText);

  const canonical = {
    document_type: invoice.document_type,
    invoice_date: invoiceDate,
    due_date: dueDate,
    currency: invoice.currency,
    tax_scenario: invoice.tax_scenario,
    seller: sellerSnapshot,
    customer: customerSnapshot,
    items: items.map((it) => ({
      position: it.position,
      description: it.description,
      quantity: it.quantity_decimal,
      unit: it.unit,
      unit_price_cents: it.unit_price_cents,
      discount_cents: it.discount_cents,
      line_total_cents: it.line_total_cents,
      rights_text: it.rights_text,
    })),
    subtotal_cents: totals.subtotalCents,
    total_cents: totals.totalCents,
    tax_exemption_text: taxText,
  };
  const canonicalString = canonicalJson(canonical);
  const contentHash = await sha256Hex(canonicalString);

  const prefixKey = PREFIX_BY_TYPE[invoice.document_type as DocumentType];
  const prefix = (settings as unknown as Record<string, string>)[
    invoice.document_type === 'RECHNUNG' ? 'prefix_rechnung'
      : invoice.document_type === 'STORNORECHNUNG' ? 'prefix_storno' : 'prefix_gutschrift'
  ] ?? String(DEFAULTS[prefixKey]);
  const year = yearOf(invoiceDate);

  // Reserve number (idempotent by key).
  const alloc = await reserveNumber(env, {
    prefix,
    year,
    digits: settings.number_digits,
    invoiceId,
    idempotencyKey,
  });

  await markIssuing(db, invoiceId, {
    sellerProfileId: seller.id,
    sellerSnapshot: JSON.stringify(sellerSnapshot),
    customerSnapshot: JSON.stringify(customerSnapshot),
    taxTextSnapshot: taxText,
    paymentTermsSnapshot: settings.payment_terms_text ?? '',
    canonicalHash: contentHash,
    idempotencyKey,
    reservedNumber: alloc.formatted,
    invoiceDate,
    dueDate,
    taxExemptionText: taxText,
    templateVersion: 'de-v1',
  });
  await audit(db, { entityType: 'invoice', entityId: invoiceId, eventType: 'INVOICE_NUMBER_RESERVED', actorEmail, metadata: { number: alloc.formatted } });

  try {
    const html = renderInvoiceDocument({
      language,
      invoiceNumber: alloc.formatted,
      documentType: invoice.document_type as DocumentType,
      invoiceDate,
      dueDate,
      serviceDate: invoice.service_date,
      servicePeriodStart: invoice.service_period_start,
      servicePeriodEnd: invoice.service_period_end,
      currency: invoice.currency,
      seller: sellerSnapshot,
      customer: customerSnapshot,
      customerCode: customer.customer_code,
      projectNumber: invoice.project_number,
      projectName: invoice.project_name,
      buyerReference: invoice.buyer_reference,
      orderReference: invoice.order_reference ?? invoice.purchase_order_reference,
      items: items.map((it) => ({
        position: it.position,
        description: it.description,
        quantity: it.quantity_decimal,
        unit: it.unit,
        unitPriceCents: it.unit_price_cents,
        discountCents: it.discount_cents,
        lineTotalCents: it.line_total_cents,
        rightsText: it.rights_text,
      })),
      totalCents: totals.totalCents,
      subtotalCents: totals.subtotalCents,
      taxExemptionText: taxText,
      paymentTermsText: settings.payment_terms_text,
      thanksText: settings.thanks_text,
      showBank: settings.show_bank,
      accentColor: settings.accent_color,
      brandHeading: settings.brand_heading ?? undefined,
      draft: false,
    });

    const pdf = await generatePdf(env, html);

    // Store canonical JSON snapshot + PDF immutably.
    await storeImmutable({
      db, bucket: env.ARCHIVE_BUCKET, area: 'outgoing', date: invoiceDate,
      entityType: 'invoice', entityId: invoiceId, documentRole: 'canonical_json',
      filename: `${alloc.formatted}.json`, mimeType: 'application/json', body: canonicalString,
    });
    const custLabel = (customerSnapshot.company_name as string) || (customerSnapshot.name as string) || 'Kunde';
    const pdfName = settings.filename_pattern
      .replace('{number}', alloc.formatted)
      .replace('{customer}', String(custLabel).replace(/[^A-Za-z0-9._-]/g, '-'));
    const stored = await storeImmutable({
      db, bucket: env.ARCHIVE_BUCKET, area: 'outgoing', date: invoiceDate,
      entityType: 'invoice', entityId: invoiceId, documentRole: 'pdf',
      filename: pdfName, mimeType: 'application/pdf', body: pdf,
    });
    await audit(db, { entityType: 'invoice', entityId: invoiceId, eventType: 'PDF_GENERATED', actorEmail, metadata: { sha256: stored.sha256 } });

    // Finalize: assign number + ISSUED, then confirm the reservation.
    await markIssued(db, invoiceId, alloc.formatted);
    await confirmNumber(env, prefix, year, alloc.sequence);
    await audit(db, {
      entityType: 'invoice', entityId: invoiceId, eventType: 'INVOICE_ISSUED', actorEmail,
      newValue: { number: alloc.formatted, hash: contentHash },
      metadata: { total_cents: totals.totalCents },
    });

    return { invoiceId, invoiceNumber: alloc.formatted, pdfDocumentId: stored.documentId, contentHash };
  } catch (err) {
    // Roll back: void the reserved number (never reused), record failure, allow retry.
    const detail = err instanceof Error ? err.message : String(err);
    await voidNumber(env, prefix, year, alloc.sequence, `issue failed: ${detail}`).catch(() => {});
    await setStatus(db, invoiceId, 'READY_TO_ISSUE').catch(() => {});
    await run(
      db,
      `INSERT INTO job_failures (id, job_type, entity_type, entity_id, error_text, payload_json)
       VALUES (?1,'ISSUE_INVOICE','invoice',?2,?3,?4)`,
      newId('job'), invoiceId, detail, JSON.stringify({ reservedNumber: alloc.formatted, idempotencyKey }),
    );
    await audit(db, {
      entityType: 'invoice', entityId: invoiceId, eventType: 'INVOICE_ISSUE_FAILED', actorEmail,
      metadata: { voidedNumber: alloc.formatted, error: detail },
    });
    throw new AppError('PDF_FAILED', detail);
  }
}
