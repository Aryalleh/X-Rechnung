import { assertIranBuyerIssuable, iranTreatment, isIranCurrency, type IranTreatment } from './iran-tax';
import type { z } from 'zod';
import { invoiceDraftSchema } from '../lib/schemas';
import { computeTotals, computeDocumentTotals, type LineInput } from '../lib/money';
import { berlinToday, addDays, yearOf } from '../lib/format';
import {
  createDraft, updateDraftHeader, replaceDraftItems, getInvoice, getItems,
  setFinancials, replaceInstallments, setIranTax,
  type Invoice, type InvoiceItem,
} from '../db/repositories/invoice-repo';
import { getCustomerById, getCustomerByCode } from '../db/repositories/customer-repo';
import { snapshotCustomer } from './customer-service';
import { getActiveSeller } from '../db/repositories/seller-repo';
import { AppError } from '../lib/errors';
import { audit } from './audit-service';
import { getInvoiceSettings } from './settings-service';

type DraftBody = z.infer<typeof invoiceDraftSchema>;

async function resolveCustomerId(db: D1Database, body: DraftBody): Promise<string | null> {
  if (body.customer_id) return body.customer_id;
  if (body.customer_code) {
    const c = await getCustomerByCode(db, body.customer_code.trim());
    if (!c) throw new AppError('CUSTOMER_NOT_FOUND');
    return c.id;
  }
  return null;
}

/**
 * Backend-authoritative total computation. Line totals from the frontend are
 * ignored — we always recompute from quantity × unit price − discount.
 */
function recompute(items: DraftBody['items']): { lines: (LineInput & { total: number })[]; totals: ReturnType<typeof computeTotals> } {
  const lineInputs: LineInput[] = items.map((it) => ({
    quantity: it.quantity_decimal,
    unitPriceCents: it.unit_price_cents,
    discountCents: it.discount_cents,
  }));
  const totals = computeTotals(lineInputs);
  const lines = lineInputs.map((l, i) => ({ ...l, total: totals.lineTotals[i]! }));
  return { lines, totals };
}

/**
 * Iranian (rial/toman) invoices follow Iranian VAT law, not the German
 * scenarios: the rate comes from the seller's registration status
 * (micro business → 0, VAT-registered → configured rate).
 */
async function applyIranRules(db: D1Database, body: DraftBody): Promise<{ body: DraftBody; iran: IranTreatment | null }> {
  if (!isIranCurrency(body.currency)) return { body, iran: null };
  const iran = iranTreatment(await getActiveSeller(db), body.iran_invoice_type);
  return { body: { ...body, tax_scenario: 'CUSTOM_TAX_SCENARIO', tax_rate_bp: iran.rateBp }, iran };
}

/** Compute document-level discount/VAT/advance and persist financials + installments. */
async function persistFinancials(db: D1Database, id: string, body: DraftBody): Promise<void> {
  const taxRateBp = body.tax_scenario === 'KLEINUNTERNEHMER_DE' ? 0 : body.tax_rate_bp;
  const doc = computeDocumentTotals({
    lines: body.items.map((it) => ({ quantity: it.quantity_decimal, unitPriceCents: it.unit_price_cents, discountCents: it.discount_cents })),
    discountMode: body.discount_mode,
    discountValue: body.discount_value,
    taxRateBp,
    advancePaidCents: body.advance_paid_cents,
  });
  await setFinancials(db, id, {
    discountMode: body.discount_mode,
    discountValue: body.discount_value,
    subtotalCents: doc.lineSubtotalCents,
    globalDiscountCents: doc.discountCents,
    taxRateBp,
    taxAmountCents: doc.taxCents,
    totalCents: doc.totalCents,
    advancePaidCents: doc.advancePaidCents,
    amountDueCents: doc.amountDueCents,
  });
  await replaceInstallments(db, id, body.installments);
}

export async function createInvoiceDraft(db: D1Database, rawBody: DraftBody, actorEmail: string): Promise<Invoice> {
  const { body, iran } = await applyIranRules(db, rawBody);
  enforceTaxScenario(body);
  const customerId = await resolveCustomerId(db, body);
  let customerSnapshot: string | null = null;
  if (customerId) {
    const c = await getCustomerById(db, customerId);
    if (c) customerSnapshot = JSON.stringify(snapshotCustomer(c));
  }

  const draft = await createDraft(db, {
    document_type: body.document_type,
    customer_id: customerId,
    project_number: body.project_number ?? null,
    project_name: body.project_name ?? null,
    invoice_date: body.invoice_date ?? null,
    service_date: body.service_date ?? null,
    service_period_start: body.service_period_start ?? null,
    service_period_end: body.service_period_end ?? null,
    due_date: body.due_date ?? null,
    currency: body.currency,
    invoice_language: body.invoice_language,
    tax_scenario: body.tax_scenario,
    buyer_reference: body.buyer_reference ?? null,
    purchase_order_reference: body.purchase_order_reference ?? null,
    order_reference: body.order_reference ?? null,
    public_note: body.public_note ?? null,
    internal_note: body.internal_note ?? null,
    customer_snapshot_json: customerSnapshot,
  });

  const { lines, totals } = recompute(body.items);
  await replaceDraftItems(
    db,
    draft.id,
    body.items.map((it, i) => ({
      position: i + 1,
      description: it.description,
      quantity_decimal: it.quantity_decimal,
      unit: it.unit,
      unit_price_cents: it.unit_price_cents,
      discount_cents: it.discount_cents,
      line_total_cents: lines[i]!.total,
      rights_text: it.rights_text ?? null,
    })),
    { subtotal: totals.subtotalCents, discount: totals.discountCents, total: totals.totalCents },
  );
  await persistFinancials(db, draft.id, body);
  await setIranTax(db, draft.id, iran?.mode ?? null, iran?.invoiceType ?? null);

  await audit(db, { entityType: 'invoice', entityId: draft.id, eventType: 'INVOICE_DRAFT_CREATED', actorEmail });
  return (await getInvoice(db, draft.id))!;
}

export async function updateInvoiceDraft(db: D1Database, id: string, rawBody: DraftBody, actorEmail: string): Promise<Invoice> {
  const { body, iran } = await applyIranRules(db, rawBody);
  const current = await getInvoice(db, id);
  if (!current) throw new AppError('NOT_FOUND');
  if (current.status !== 'DRAFT') throw new AppError('INVOICE_LOCKED');
  enforceTaxScenario(body);

  const customerId = await resolveCustomerId(db, body);
  let customerSnapshot = current.customer_snapshot_json;
  if (customerId && customerId !== current.customer_id) {
    const c = await getCustomerById(db, customerId);
    if (c) customerSnapshot = JSON.stringify(snapshotCustomer(c));
  }

  await updateDraftHeader(db, id, {
    document_type: body.document_type,
    customer_id: customerId,
    project_number: body.project_number ?? null,
    project_name: body.project_name ?? null,
    invoice_date: body.invoice_date ?? null,
    service_date: body.service_date ?? null,
    service_period_start: body.service_period_start ?? null,
    service_period_end: body.service_period_end ?? null,
    due_date: body.due_date ?? null,
    currency: body.currency,
    invoice_language: body.invoice_language,
    tax_scenario: body.tax_scenario,
    buyer_reference: body.buyer_reference ?? null,
    purchase_order_reference: body.purchase_order_reference ?? null,
    order_reference: body.order_reference ?? null,
    public_note: body.public_note ?? null,
    internal_note: body.internal_note ?? null,
    customer_snapshot_json: customerSnapshot,
  });

  const { lines, totals } = recompute(body.items);
  await replaceDraftItems(
    db, id,
    body.items.map((it, i) => ({
      position: i + 1,
      description: it.description,
      quantity_decimal: it.quantity_decimal,
      unit: it.unit,
      unit_price_cents: it.unit_price_cents,
      discount_cents: it.discount_cents,
      line_total_cents: lines[i]!.total,
      rights_text: it.rights_text ?? null,
    })),
    { subtotal: totals.subtotalCents, discount: totals.discountCents, total: totals.totalCents },
  );
  await persistFinancials(db, id, body);
  await setIranTax(db, id, iran?.mode ?? null, iran?.invoiceType ?? null);

  await audit(db, { entityType: 'invoice', entityId: id, eventType: 'INVOICE_DRAFT_UPDATED', actorEmail });
  return (await getInvoice(db, id))!;
}

/**
 * Kleinunternehmer §19 enforcement: in KLEINUNTERNEHMER_DE mode no VAT rate may
 * be charged (persistFinancials also forces tax_rate_bp to 0). A VAT rate is
 * only meaningful for the business/custom scenarios (e.g. Iranian 10%, German
 * 19%). We reject an explicit non-zero rate under Kleinunternehmer so it can't
 * slip in silently.
 */
export function enforceTaxScenario(body: DraftBody): void {
  if (body.tax_scenario === 'KLEINUNTERNEHMER_DE' && body.tax_rate_bp > 0) {
    throw new AppError('VALIDATION_ERROR', 'VAT is not allowed in Kleinunternehmer mode', { tax_rate_bp: 'vat_not_allowed_kleinunternehmer' });
  }
}

/** Validate a draft has all §34a + house-rule mandatory fields before issuing. */
export async function assertReadyToIssue(
  db: D1Database,
  invoice: Invoice,
  items: InvoiceItem[],
): Promise<void> {
  const seller = await getActiveSeller(db);
  if (!seller) throw new AppError('SELLER_INCOMPLETE');
  if (!invoice.customer_id) throw new AppError('VALIDATION_ERROR', 'customer required', { customer: 'customer_required' });
  const cust = await getCustomerById(db, invoice.customer_id);
  if (!cust) throw new AppError('CUSTOMER_NOT_FOUND');
  if (isIranCurrency(invoice.currency)) {
    assertIranBuyerIssuable(cust, iranTreatment(seller, invoice.iran_invoice_type));
    if (items.length === 0) throw new AppError('VALIDATION_ERROR', 'no line items', { items: 'items_required' });
    return;
  }
  const custComplete = Boolean((cust.company_name || cust.last_name) && cust.street && cust.postal_code && cust.city);
  if (!custComplete) throw new AppError('VALIDATION_ERROR', 'customer address incomplete', { customer: 'customer_address_incomplete' });
  if (items.length === 0) throw new AppError('VALIDATION_ERROR', 'no line items', { items: 'items_required' });
}

/** Resolve invoice_date and due_date defaults from settings/customer/seller. */
export async function resolveDates(
  db: D1Database,
  invoice: Invoice,
): Promise<{ invoiceDate: string; dueDate: string }> {
  const invoiceDate = invoice.invoice_date ?? berlinToday();
  let paymentDays: number;
  const settings = await getInvoiceSettings(db);
  if (invoice.customer_id) {
    const c = await getCustomerById(db, invoice.customer_id);
    paymentDays = c?.payment_days ?? settings.payment_days;
  } else {
    paymentDays = settings.payment_days;
  }
  const dueDate = invoice.due_date ?? addDays(invoiceDate, paymentDays);
  return { invoiceDate, dueDate };
}

export { yearOf };
