/** Compose + send an invoice email with the PDF attached. */
import type { Env } from '../../config/env';
import { getInvoice } from '../../db/repositories/invoice-repo';
import { findByRole } from '../../db/repositories/document-repo';
import { getGroup } from '../../db/repositories/settings-repo';
import { getActiveSeller } from '../../db/repositories/seller-repo';
import { formatEuro, formatDateDe } from '../../lib/format';
import { newId } from '../../lib/ids';
import { run } from '../../db/client';
import { AppError } from '../../lib/errors';
import { audit } from '../audit-service';
import { resolveProvider, type OutboundMessage } from './sender';
import { fetchObject } from '../archive-service';

const DEFAULT_SUBJECT = 'Rechnung {{invoiceNumber}} – {{projectTitle}}';
const DEFAULT_BODY = `Guten Tag {{customerName}},

anbei erhalten Sie die Rechnung {{invoiceNumber}} für das Projekt
„{{projectTitle}}“.

Der Rechnungsbetrag beträgt {{total}} und ist bis zum
{{dueDate}} zahlbar.

Vielen Dank für die Zusammenarbeit.

Mit freundlichen Grüßen
{{sellerName}}`;

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? '');
}

export interface SendInvoiceInput {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
}

export async function sendInvoiceEmail(env: Env, invoiceId: string, input: SendInvoiceInput, actorEmail: string) {
  const invoice = await getInvoice(env.DB, invoiceId);
  if (!invoice) throw new AppError('NOT_FOUND');
  if (invoice.status === 'DRAFT') throw new AppError('CONFLICT', 'cannot email a draft');

  const seller = await getActiveSeller(env.DB);
  const out = await getGroup(env.DB, 'EMAIL_OUTBOUND');
  const customer = invoice.customer_snapshot_json ? JSON.parse(invoice.customer_snapshot_json) as Record<string, string> : {};
  const to = input.to || customer.email;
  if (!to) throw new AppError('VALIDATION_ERROR', 'no recipient', { to: 'گیرنده مشخص نیست' });

  const vars = {
    invoiceNumber: invoice.invoice_number ?? '',
    projectTitle: invoice.project_name ?? '',
    customerName: customer.company_name || customer.name || '',
    total: formatEuro(invoice.total_cents, invoice.currency),
    dueDate: formatDateDe(invoice.due_date),
    sellerName: seller?.full_name ?? '',
  };
  const subject = fill(input.subject || (out.subject as string) || DEFAULT_SUBJECT, vars);
  const text = fill(input.body || (out.body as string) || DEFAULT_BODY, vars);

  const from = (out.from_email as string) || seller?.email || '';
  if (!from) throw new AppError('CONFLICT', 'outbound From email not configured');

  // Attach the archived PDF.
  const pdfDoc = await findByRole(env.DB, 'invoice', invoiceId, 'pdf');
  let attachment: OutboundMessage['attachment'];
  if (pdfDoc) {
    const obj = await fetchObject(env.ARCHIVE_BUCKET, pdfDoc.r2_key);
    if (obj) {
      const bytes = new Uint8Array(await obj.arrayBuffer());
      attachment = { filename: pdfDoc.original_filename ?? `${invoice.invoice_number}.pdf`, mime: 'application/pdf', bytes };
    }
  }

  const outboundId = newId('out');
  await run(
    env.DB,
    `INSERT INTO outbound_emails (id, invoice_id, to_email, cc_email, bcc_email, subject, status)
     VALUES (?1,?2,?3,?4,?5,?6,'QUEUED')`,
    outboundId, invoiceId, to, input.cc ?? (out.bcc as string) ?? null, input.bcc ?? null, subject,
  );

  try {
    const provider = await resolveProvider(env);
    const msg: OutboundMessage = {
      from,
      fromName: (out.from_name as string) || seller?.full_name || '',
      to,
      subject,
      text,
      ...(input.cc ? { cc: input.cc } : {}),
      ...(input.bcc || out.bcc ? { bcc: (input.bcc || out.bcc) as string } : {}),
      ...(out.reply_to ? { replyTo: out.reply_to as string } : {}),
      ...(attachment ? { attachment } : {}),
    };
    const result = await provider.send(env, msg);
    await run(
      env.DB,
      `UPDATE outbound_emails SET status='SENT', provider=?2, message_id=?3, sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1`,
      outboundId, result.provider, result.messageId,
    );
    await run(env.DB, `UPDATE invoices SET status = CASE WHEN status='ISSUED' THEN 'SENT' ELSE status END, sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1`, invoiceId);
    await audit(env.DB, { entityType: 'invoice', entityId: invoiceId, eventType: 'INVOICE_SENT', actorEmail, metadata: { to, messageId: result.messageId } });
    return { outboundId, messageId: result.messageId, status: 'SENT' };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await run(env.DB, `UPDATE outbound_emails SET status='FAILED', error_text=?2, retry_count=retry_count+1 WHERE id=?1`, outboundId, detail);
    throw new AppError('INTERNAL', `email send failed: ${detail}`);
  }
}
