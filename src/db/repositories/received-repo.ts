import { one, all, run } from '../client';
import { newId } from '../../lib/ids';
import type { ExtractedInvoice } from '../../services/einvoice/parse';

export interface ReceivedInvoice {
  id: string;
  source: string;
  format: string | null;
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string | null;
  gross_amount_cents: number | null;
  validation_status: string;
  duplicate_status: string;
  payment_status: string;
  file_sha256: string | null;
  created_at: string;
}

export async function createReceivedInvoice(
  db: D1Database,
  x: ExtractedInvoice,
  meta: { source: 'EMAIL' | 'UPLOAD'; receivedEmailId?: string; fileSha256: string },
): Promise<string> {
  const id = newId('rcv');
  await run(
    db,
    `INSERT INTO received_invoices
       (id, source, received_email_id, format, profile_id, customization_id, document_type,
        supplier_name, supplier_address, supplier_tax_id, supplier_vat_id, invoice_number,
        invoice_date, due_date, service_date, service_period, currency, net_amount_cents,
        tax_amount_cents, gross_amount_cents, payment_terms, iban, bic, buyer_reference,
        purchase_order_reference, contract_reference, extracted_json, validation_status, file_sha256)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,'PENDING',?28)`,
    id, meta.source, meta.receivedEmailId ?? null, x.format, x.profileId, x.customizationId, x.documentType,
    x.supplierName, x.supplierAddress, x.supplierTaxId, x.supplierVatId, x.invoiceNumber, x.invoiceDate,
    x.dueDate, x.serviceDate, x.servicePeriod, x.currency, x.netAmountCents, x.taxAmountCents,
    x.grossAmountCents, x.paymentTerms, x.iban, x.bic, x.buyerReference, x.purchaseOrderReference,
    x.contractReference, JSON.stringify(x), meta.fileSha256,
  );
  let pos = 1;
  for (const ln of x.lines) {
    await run(
      db,
      `INSERT INTO received_invoice_items
         (id, received_invoice_id, position, description, quantity_decimal, unit, unit_price_cents, line_total_cents, tax_category)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
      newId('rci'), id, pos++, ln.description, ln.quantity, ln.unit, ln.unitPriceCents, ln.lineTotalCents, ln.taxCategory,
    );
  }
  return id;
}

export async function addReceivedFile(
  db: D1Database,
  receivedInvoiceId: string,
  file: { role: string; r2Key: string; filename: string; mime: string; size: number; sha256: string },
): Promise<void> {
  await run(
    db,
    `INSERT INTO received_invoice_files
       (id, received_invoice_id, file_role, r2_key, original_filename, mime_type, size_bytes, sha256)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`,
    newId('rcf'), receivedInvoiceId, file.role, file.r2Key, file.filename, file.mime, file.size, file.sha256,
  );
}

export async function setValidationStatus(db: D1Database, id: string, status: string): Promise<void> {
  await run(db, `UPDATE received_invoices SET validation_status=?2, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1`, id, status);
}

export async function setDuplicate(db: D1Database, id: string, status: string, matchId: string | null): Promise<void> {
  await run(db, `UPDATE received_invoices SET duplicate_status=?2, duplicate_of=?3 WHERE id=?1`, id, status, matchId);
}

export async function recordValidationResult(
  db: D1Database,
  receivedInvoiceId: string,
  level: 'BASIC' | 'STRICT',
  status: string,
  opts: { validatorName?: string; validatorVersion?: string | null; rulesetVersion?: string | null; report?: unknown; messages?: string[] } = {},
): Promise<void> {
  await run(
    db,
    `INSERT INTO validation_results
       (id, received_invoice_id, level, status, validator_name, validator_version, ruleset_version, report_json, messages_json)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
    newId('val'), receivedInvoiceId, level, status, opts.validatorName ?? null, opts.validatorVersion ?? null,
    opts.rulesetVersion ?? null, opts.report ? JSON.stringify(opts.report) : null,
    opts.messages ? JSON.stringify(opts.messages) : null,
  );
}

export function getReceivedInvoice(db: D1Database, id: string) {
  return one<Record<string, unknown>>(db, `SELECT * FROM received_invoices WHERE id = ?1`, id);
}

export function listReceivedInvoices(db: D1Database, limit = 100) {
  return all<ReceivedInvoice>(db, `SELECT * FROM received_invoices ORDER BY created_at DESC LIMIT ?1`, limit);
}

export function getReceivedFiles(db: D1Database, id: string) {
  return all<Record<string, unknown>>(db, `SELECT * FROM received_invoice_files WHERE received_invoice_id = ?1`, id);
}

export function getReceivedItems(db: D1Database, id: string) {
  return all<Record<string, unknown>>(db, `SELECT * FROM received_invoice_items WHERE received_invoice_id = ?1 ORDER BY position`, id);
}

export function getValidationResults(db: D1Database, id: string) {
  return all<Record<string, unknown>>(db, `SELECT * FROM validation_results WHERE received_invoice_id = ?1 ORDER BY created_at`, id);
}
