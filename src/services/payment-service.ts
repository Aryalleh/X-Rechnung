import type { z } from 'zod';
import { paymentSchema } from '../lib/schemas';
import { getInvoice, setStatus } from '../db/repositories/invoice-repo';
import { insertPayment, sumPayments, listPayments } from '../db/repositories/payment-repo';
import { AppError } from '../lib/errors';
import { audit } from './audit-service';

type PaymentBody = z.infer<typeof paymentSchema>;

/**
 * Record a payment. Never mutates the issued PDF. Recomputes payment status
 * (PAID / PARTIALLY_PAID) from the sum of payments vs. the invoice total.
 * Overpayment is blocked unless explicitly allowed.
 */
export async function recordPayment(db: D1Database, invoiceId: string, body: PaymentBody, actorEmail: string) {
  const invoice = await getInvoice(db, invoiceId);
  if (!invoice) throw new AppError('NOT_FOUND');
  if (!['ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE', 'PAID'].includes(invoice.status)) {
    throw new AppError('CONFLICT', `cannot record payment for status ${invoice.status}`);
  }

  const already = await sumPayments(db, invoiceId);
  const remaining = invoice.total_cents - already;
  if (body.amount_cents > remaining && !body.allow_overpay) {
    throw new AppError('VALIDATION_ERROR', 'overpayment', { amount: 'overpayment' });
  }

  const payment = await insertPayment(db, {
    invoice_id: invoiceId,
    payment_date: body.payment_date,
    amount_cents: body.amount_cents,
    payment_method: body.payment_method,
    bank_reference: body.bank_reference ?? null,
    note: body.note ?? null,
  });

  const total = already + body.amount_cents;
  const newStatus = total >= invoice.total_cents ? 'PAID' : total > 0 ? 'PARTIALLY_PAID' : invoice.status;
  if (newStatus !== invoice.status) await setStatus(db, invoiceId, newStatus);

  await audit(db, {
    entityType: 'invoice', entityId: invoiceId, eventType: 'PAYMENT_RECORDED', actorEmail,
    metadata: { amount_cents: body.amount_cents, method: body.payment_method, new_status: newStatus },
  });

  return { payment, paidCents: total, remainingCents: invoice.total_cents - total, status: newStatus };
}

export async function getPaymentSummary(db: D1Database, invoiceId: string) {
  const invoice = await getInvoice(db, invoiceId);
  if (!invoice) throw new AppError('NOT_FOUND');
  const paid = await sumPayments(db, invoiceId);
  const payments = await listPayments(db, invoiceId);
  return { totalCents: invoice.total_cents, paidCents: paid, remainingCents: invoice.total_cents - paid, payments, status: invoice.status };
}
