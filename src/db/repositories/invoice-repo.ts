import { one, all, run, stmt, batch } from '../client';
import { newId } from '../../lib/ids';
import type { InvoiceStatus, TaxScenario, DocumentType } from '../../config/constants';

export interface Invoice {
  id: string;
  status: InvoiceStatus;
  document_type: DocumentType;
  invoice_number: string | null;
  customer_id: string | null;
  project_id: string | null;
  project_number: string | null;
  project_name: string | null;
  seller_profile_id: string | null;
  seller_snapshot_json: string | null;
  customer_snapshot_json: string | null;
  invoice_date: string | null;
  service_date: string | null;
  service_period_start: string | null;
  service_period_end: string | null;
  due_date: string | null;
  currency: string;
  invoice_language: string;
  currency_snapshot: string | null;
  tax_scenario: TaxScenario;
  iran_tax_mode: 'MICRO' | 'VAT' | null;
  iran_invoice_type: number | null;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  discount_mode: 'NONE' | 'PERCENT' | 'FIXED';
  discount_value: number;
  global_discount_cents: number;
  tax_rate_bp: number;
  tax_amount_cents: number;
  advance_paid_cents: number;
  amount_due_cents: number;
  tax_exemption_text: string | null;
  tax_text_snapshot: string | null;
  payment_terms_snapshot: string | null;
  template_version: string | null;
  buyer_reference: string | null;
  purchase_order_reference: string | null;
  order_reference: string | null;
  contract_reference: string | null;
  public_note: string | null;
  internal_note: string | null;
  canonical_json_hash: string | null;
  idempotency_key: string | null;
  reserved_number: string | null;
  issued_at: string | null;
  sent_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  position: number;
  description: string;
  quantity_decimal: string;
  unit: string;
  unit_price_cents: number;
  discount_cents: number;
  line_total_cents: number;
  rights_text: string | null;
  created_at: string;
}

export function getInvoice(db: D1Database, id: string): Promise<Invoice | null> {
  return one<Invoice>(db, `SELECT * FROM invoices WHERE id = ?1`, id);
}

export function getInvoiceByIdempotency(db: D1Database, key: string): Promise<Invoice | null> {
  return one<Invoice>(db, `SELECT * FROM invoices WHERE idempotency_key = ?1`, key);
}

export function getItems(db: D1Database, invoiceId: string): Promise<InvoiceItem[]> {
  return all<InvoiceItem>(db, `SELECT * FROM invoice_items WHERE invoice_id = ?1 ORDER BY position`, invoiceId);
}

export function listInvoices(db: D1Database, opts: { status?: string; limit?: number } = {}): Promise<Invoice[]> {
  const limit = opts.limit ?? 100;
  // Include a display name for the customer so lists don't need N+1 lookups.
  const base = `SELECT i.*, c.customer_code AS customer_code,
      COALESCE(NULLIF(c.company_name, ''), TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS customer_name
    FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id`;
  if (opts.status) {
    return all<Invoice>(db, `${base} WHERE i.status = ?1 ORDER BY i.created_at DESC LIMIT ?2`, opts.status, limit);
  }
  return all<Invoice>(db, `${base} ORDER BY i.created_at DESC LIMIT ?1`, limit);
}

export async function createDraft(db: D1Database, partial: Partial<Invoice>): Promise<Invoice> {
  const id = newId('inv');
  await run(
    db,
    `INSERT INTO invoices
       (id, status, document_type, customer_id, project_number, project_name, invoice_date,
        service_date, service_period_start, service_period_end, due_date, currency, invoice_language,
        tax_scenario, buyer_reference, purchase_order_reference, order_reference, public_note,
        internal_note, customer_snapshot_json, contract_reference)
     VALUES (?1,'DRAFT',?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)`,
    id,
    partial.document_type ?? 'RECHNUNG',
    partial.customer_id ?? null,
    partial.project_number ?? null,
    partial.project_name ?? null,
    partial.invoice_date ?? null,
    partial.service_date ?? null,
    partial.service_period_start ?? null,
    partial.service_period_end ?? null,
    partial.due_date ?? null,
    partial.currency ?? 'EUR',
    partial.invoice_language ?? 'de',
    partial.tax_scenario ?? 'KLEINUNTERNEHMER_DE',
    partial.buyer_reference ?? null,
    partial.purchase_order_reference ?? null,
    partial.order_reference ?? null,
    partial.public_note ?? null,
    partial.internal_note ?? null,
    partial.customer_snapshot_json ?? null,
    partial.contract_reference ?? null,
  );
  return (await getInvoice(db, id))!;
}

/** Replace draft items and header fields, and recompute totals, atomically. */
export async function replaceDraftItems(
  db: D1Database,
  invoiceId: string,
  items: Omit<InvoiceItem, 'id' | 'invoice_id' | 'created_at'>[],
  totals: { subtotal: number; discount: number; total: number },
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    stmt(db, `DELETE FROM invoice_items WHERE invoice_id = ?1`, invoiceId),
  ];
  for (const it of items) {
    statements.push(
      stmt(
        db,
        `INSERT INTO invoice_items
           (id, invoice_id, position, description, quantity_decimal, unit, unit_price_cents, discount_cents, line_total_cents, rights_text)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
        newId('itm'), invoiceId, it.position, it.description, it.quantity_decimal, it.unit,
        it.unit_price_cents, it.discount_cents, it.line_total_cents, it.rights_text ?? null,
      ),
    );
  }
  statements.push(
    stmt(
      db,
      `UPDATE invoices SET subtotal_cents=?2, discount_cents=?3, total_cents=?4,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1`,
      invoiceId, totals.subtotal, totals.discount, totals.total,
    ),
  );
  await batch(db, statements);
}

export async function updateDraftHeader(db: D1Database, invoiceId: string, patch: Partial<Invoice>): Promise<void> {
  const current = await getInvoice(db, invoiceId);
  if (!current) return;
  const m = { ...current, ...patch };
  await run(
    db,
    `UPDATE invoices SET
       document_type=?2, customer_id=?3, project_number=?4, project_name=?5, invoice_date=?6,
       service_date=?7, service_period_start=?8, service_period_end=?9, due_date=?10, currency=?11,
       tax_scenario=?12, buyer_reference=?13, purchase_order_reference=?14, order_reference=?15,
       public_note=?16, internal_note=?17, customer_snapshot_json=?18, invoice_language=?19,
       contract_reference=?20, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id=?1`,
    invoiceId, m.document_type, m.customer_id, m.project_number, m.project_name, m.invoice_date,
    m.service_date, m.service_period_start, m.service_period_end, m.due_date, m.currency, m.tax_scenario,
    m.buyer_reference, m.purchase_order_reference, m.order_reference, m.public_note, m.internal_note,
    m.customer_snapshot_json, m.invoice_language, m.contract_reference ?? null,
  );
}

export async function setStatus(db: D1Database, invoiceId: string, status: InvoiceStatus): Promise<void> {
  await run(db, `UPDATE invoices SET status=?2, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1`, invoiceId, status);
}

export async function deleteDraft(db: D1Database, invoiceId: string): Promise<void> {
  await run(db, `DELETE FROM invoices WHERE id = ?1 AND status = 'DRAFT'`, invoiceId);
}

/** Persist issue-time snapshots + reservation before PDF generation. */
export async function markIssuing(
  db: D1Database,
  invoiceId: string,
  data: {
    sellerProfileId: string;
    sellerSnapshot: string;
    customerSnapshot: string;
    taxTextSnapshot: string;
    paymentTermsSnapshot: string;
    canonicalHash: string;
    idempotencyKey: string;
    reservedNumber: string;
    invoiceDate: string;
    dueDate: string;
    taxExemptionText: string;
    templateVersion: string;
  },
): Promise<void> {
  await run(
    db,
    `UPDATE invoices SET
       status='ISSUING', seller_profile_id=?2, seller_snapshot_json=?3, customer_snapshot_json=?4,
       tax_text_snapshot=?5, payment_terms_snapshot=?6, canonical_json_hash=?7, idempotency_key=?8,
       reserved_number=?9, invoice_date=?10, due_date=?11, tax_exemption_text=?12, template_version=?13,
       updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id=?1`,
    invoiceId, data.sellerProfileId, data.sellerSnapshot, data.customerSnapshot, data.taxTextSnapshot,
    data.paymentTermsSnapshot, data.canonicalHash, data.idempotencyKey, data.reservedNumber,
    data.invoiceDate, data.dueDate, data.taxExemptionText, data.templateVersion,
  );
}

/** Finalize: assign number + ISSUED status atomically. */
export async function markIssued(db: D1Database, invoiceId: string, invoiceNumber: string): Promise<void> {
  await run(
    db,
    `UPDATE invoices SET status='ISSUED', invoice_number=?2,
       issued_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
       updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id=?1`,
    invoiceId, invoiceNumber,
  );
}

export async function addRelation(
  db: D1Database,
  invoiceId: string,
  relatedInvoiceId: string,
  relationType: 'CANCELS' | 'CANCELLED_BY' | 'REPLACES' | 'REPLACED_BY' | 'CREDIT_FOR',
): Promise<void> {
  await run(
    db,
    `INSERT INTO invoice_relations (id, invoice_id, related_invoice_id, relation_type) VALUES (?1,?2,?3,?4)`,
    newId('rel'), invoiceId, relatedInvoiceId, relationType,
  );
}

export function getRelations(db: D1Database, invoiceId: string) {
  return all<{ id: string; related_invoice_id: string; relation_type: string }>(
    db,
    `SELECT id, related_invoice_id, relation_type FROM invoice_relations WHERE invoice_id = ?1`,
    invoiceId,
  );
}

// --------------------------------------------------------------------------
// Financials (document discount / VAT / advance) + installment schedule.
// --------------------------------------------------------------------------

export interface Financials {
  discountMode: 'NONE' | 'PERCENT' | 'FIXED';
  discountValue: number;
  subtotalCents: number;
  globalDiscountCents: number;
  taxRateBp: number;
  taxAmountCents: number;
  totalCents: number;
  advancePaidCents: number;
  amountDueCents: number;
}

export async function setFinancials(db: D1Database, invoiceId: string, f: Financials): Promise<void> {
  await run(
    db,
    `UPDATE invoices SET
       discount_mode=?2, discount_value=?3, subtotal_cents=?4, global_discount_cents=?5,
       discount_cents=?5, tax_rate_bp=?6, tax_amount_cents=?7, total_cents=?8,
       advance_paid_cents=?9, amount_due_cents=?10, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id=?1`,
    invoiceId, f.discountMode, f.discountValue, f.subtotalCents, f.globalDiscountCents,
    f.taxRateBp, f.taxAmountCents, f.totalCents, f.advancePaidCents, f.amountDueCents,
  );
}

export interface InstallmentInput { label?: string; due_date?: string; amount_cents: number; }
export interface Installment { id: string; position: number; label: string | null; due_date: string | null; amount_cents: number; paid: number; paid_at: string | null; }

export async function replaceInstallments(db: D1Database, invoiceId: string, items: InstallmentInput[]): Promise<void> {
  const statements: D1PreparedStatement[] = [stmt(db, `DELETE FROM invoice_installments WHERE invoice_id = ?1`, invoiceId)];
  items.forEach((it, i) => {
    statements.push(stmt(
      db,
      `INSERT INTO invoice_installments (id, invoice_id, position, label, due_date, amount_cents) VALUES (?1,?2,?3,?4,?5,?6)`,
      newId('ins'), invoiceId, i + 1, it.label ?? null, it.due_date ?? null, it.amount_cents,
    ));
  });
  await batch(db, statements);
}

export function getInstallments(db: D1Database, invoiceId: string): Promise<Installment[]> {
  return all<Installment>(db, `SELECT * FROM invoice_installments WHERE invoice_id = ?1 ORDER BY position`, invoiceId);
}

export async function markInstallmentPaid(db: D1Database, id: string, paid: boolean): Promise<void> {
  await run(
    db,
    `UPDATE invoice_installments SET paid=?2, paid_at=CASE WHEN ?2=1 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END WHERE id=?1`,
    id, paid ? 1 : 0,
  );
}

/** Record the Iranian tax treatment (NULLs for non-Iranian invoices). */
export async function setIranTax(db: D1Database, id: string, mode: string | null, type: number | null): Promise<void> {
  await run(db, `UPDATE invoices SET iran_tax_mode = ?2, iran_invoice_type = ?3 WHERE id = ?1`, id, mode, type);
}
