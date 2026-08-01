import { Hono } from 'hono';
import type { HonoEnv } from '../http-types';
import { z } from 'zod';
import { ok } from '../lib/response';
import { AppError } from '../lib/errors';
import { parseBody } from '../lib/validate-request';
import { invoiceDraftSchema } from '../lib/schemas';
import { rateLimit } from '../middleware/rate-limit';
import {
  getInvoice, getItems, listInvoices, deleteDraft, setStatus, getRelations,
} from '../db/repositories/invoice-repo';
import { getActiveSeller } from '../db/repositories/seller-repo';
import { getCustomerById } from '../db/repositories/customer-repo';
import { createInvoiceDraft, updateInvoiceDraft, resolveDates } from '../services/invoice-service';
import { issueInvoice } from '../services/issue-service';
import { createStorno, createReplacementDraft } from '../services/cancellation-service';
import { sendInvoiceEmail } from '../services/email/invoice-email';
import { getPaymentSummary } from '../services/payment-service';
import { snapshotSeller } from '../services/seller-service';
import { snapshotCustomer } from '../services/customer-service';
import { getInvoiceSettings } from '../services/settings-service';
import { renderInvoiceHtml } from '../services/pdf/template';
import { newId } from '../lib/ids';
import type { DocumentType } from '../config/constants';

export const invoiceRoutes = new Hono<HonoEnv>();

invoiceRoutes.get('/', async (c) => {
  const status = c.req.query('status');
  return ok(c, await listInvoices(c.env.DB, status ? { status } : {}));
});

invoiceRoutes.get('/:id', async (c) => {
  const invoice = await getInvoice(c.env.DB, c.req.param('id'));
  if (!invoice) throw new AppError('NOT_FOUND');
  const items = await getItems(c.env.DB, invoice.id);
  const payments = await getPaymentSummary(c.env.DB, invoice.id);
  const relations = await getRelations(c.env.DB, invoice.id);
  return ok(c, { invoice, items, payments, relations });
});

invoiceRoutes.post('/', async (c) => {
  const body = await parseBody(c, invoiceDraftSchema);
  const draft = await createInvoiceDraft(c.env.DB, body, c.get('actor')!.email);
  return ok(c, draft, 201);
});

invoiceRoutes.put('/:id', async (c) => {
  const body = await parseBody(c, invoiceDraftSchema);
  const updated = await updateInvoiceDraft(c.env.DB, c.req.param('id'), body, c.get('actor')!.email);
  return ok(c, updated);
});

invoiceRoutes.delete('/:id', async (c) => {
  const invoice = await getInvoice(c.env.DB, c.req.param('id'));
  if (!invoice) throw new AppError('NOT_FOUND');
  if (invoice.status !== 'DRAFT') throw new AppError('INVOICE_LOCKED');
  await deleteDraft(c.env.DB, invoice.id);
  return ok(c, { deleted: true });
});

/** Live HTML preview (draft => ENTWURF watermark). Not stored. */
invoiceRoutes.get('/:id/preview', async (c) => {
  const invoice = await getInvoice(c.env.DB, c.req.param('id'));
  if (!invoice) throw new AppError('NOT_FOUND');
  const items = await getItems(c.env.DB, invoice.id);
  const seller = await getActiveSeller(c.env.DB);
  if (!seller) throw new AppError('SELLER_INCOMPLETE');
  const customer = invoice.customer_id ? await getCustomerById(c.env.DB, invoice.customer_id) : null;
  const settings = await getInvoiceSettings(c.env.DB);
  const { invoiceDate, dueDate } = await resolveDates(c.env.DB, invoice);
  const isDraft = invoice.status === 'DRAFT' || invoice.status === 'READY_TO_ISSUE';

  const html = renderInvoiceHtml({
    invoiceNumber: invoice.invoice_number ?? 'ENTWURF',
    documentType: invoice.document_type as DocumentType,
    invoiceDate, dueDate,
    serviceDate: invoice.service_date,
    servicePeriodStart: invoice.service_period_start,
    servicePeriodEnd: invoice.service_period_end,
    currency: invoice.currency,
    seller: snapshotSeller(seller),
    customer: customer ? snapshotCustomer(customer) : {},
    customerCode: customer?.customer_code ?? '',
    projectNumber: invoice.project_number,
    projectName: invoice.project_name,
    buyerReference: invoice.buyer_reference,
    orderReference: invoice.order_reference ?? invoice.purchase_order_reference,
    items: items.map((it) => ({
      position: it.position, description: it.description, quantity: it.quantity_decimal, unit: it.unit,
      unitPriceCents: it.unit_price_cents, discountCents: it.discount_cents, lineTotalCents: it.line_total_cents, rightsText: it.rights_text,
    })),
    totalCents: invoice.total_cents,
    taxExemptionText: settings.tax_exemption_text || seller.tax_exemption_text,
    paymentTermsText: settings.payment_terms_text,
    thanksText: settings.thanks_text,
    showBank: settings.show_bank,
    draft: isDraft,
  });
  return c.html(html);
});

/** Idempotent final issue. */
invoiceRoutes.post('/:id/issue', rateLimit({ key: 'issue', limit: 30, windowMs: 60_000 }), async (c) => {
  const invoice = await getInvoice(c.env.DB, c.req.param('id'));
  if (!invoice) throw new AppError('NOT_FOUND');
  const idempotencyKey =
    c.req.header('Idempotency-Key') || invoice.idempotency_key || `issue-${invoice.id}-${newId('k')}`;
  const result = await issueInvoice(c.env, invoice.id, idempotencyKey, c.get('actor')!.email);
  return ok(c, result);
});

/** Create a Stornorechnung for an issued invoice. */
invoiceRoutes.post('/:id/storno', async (c) => {
  const result = await createStorno(c.env, c.req.param('id'), c.get('actor')!.email);
  return ok(c, result, 201);
});

/** Create a replacement (Ersatzrechnung) draft. */
invoiceRoutes.post('/:id/replacement', async (c) => {
  const id = await createReplacementDraft(c.env.DB, c.req.param('id'), c.get('actor')!.email);
  return ok(c, { replacementId: id }, 201);
});

/** Email the invoice with PDF attached. */
invoiceRoutes.post('/:id/send', async (c) => {
  const body = await parseBody(
    c,
    z.object({ to: z.string().email().optional(), cc: z.string().optional(), bcc: z.string().optional(), subject: z.string().optional(), body: z.string().optional() }),
  );
  const result = await sendInvoiceEmail(c.env, c.req.param('id'), body, c.get('actor')!.email);
  return ok(c, result);
});

/** Mark a draft ready to issue. */
invoiceRoutes.post('/:id/ready', async (c) => {
  const invoice = await getInvoice(c.env.DB, c.req.param('id'));
  if (!invoice) throw new AppError('NOT_FOUND');
  if (invoice.status !== 'DRAFT') throw new AppError('CONFLICT');
  await setStatus(c.env.DB, invoice.id, 'READY_TO_ISSUE');
  return ok(c, { status: 'READY_TO_ISSUE' });
});
