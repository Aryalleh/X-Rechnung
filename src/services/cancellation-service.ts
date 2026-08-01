/**
 * Cancellation (Stornorechnung) and replacement (Ersatzrechnung) workflow.
 *
 * Issued invoices are never hard-deleted or edited. To correct one we create a
 * Stornorechnung: a new document with negated amounts that references the
 * original, then optionally a fresh replacement invoice linked to both.
 */
import type { Env } from '../config/env';
import { getInvoice, getItems, createDraft, replaceDraftItems, addRelation, setStatus } from '../db/repositories/invoice-repo';
import { issueInvoice } from './issue-service';
import { AppError } from '../lib/errors';
import { audit } from './audit-service';
import { newId } from '../lib/ids';

export async function createStorno(env: Env, originalId: string, actorEmail: string): Promise<{ stornoId: string; invoiceNumber: string }> {
  const db = env.DB;
  const original = await getInvoice(db, originalId);
  if (!original) throw new AppError('NOT_FOUND');
  if (!['ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'].includes(original.status)) {
    throw new AppError('CONFLICT', 'only issued invoices can be cancelled');
  }
  const items = await getItems(db, originalId);

  const storno = await createDraft(db, {
    document_type: 'STORNORECHNUNG',
    customer_id: original.customer_id,
    project_number: original.project_number,
    project_name: original.project_name,
    currency: original.currency,
    tax_scenario: original.tax_scenario,
    customer_snapshot_json: original.customer_snapshot_json,
    public_note: `Stornorechnung zu Rechnung ${original.invoice_number}`,
  });

  // Negate every line amount.
  await replaceDraftItems(
    db, storno.id,
    items.map((it, i) => ({
      position: i + 1,
      description: it.description,
      quantity_decimal: `-${it.quantity_decimal}`,
      unit: it.unit,
      unit_price_cents: it.unit_price_cents,
      discount_cents: -it.discount_cents,
      line_total_cents: -it.line_total_cents,
      rights_text: it.rights_text,
    })),
    { subtotal: -original.subtotal_cents, discount: -original.discount_cents, total: -original.total_cents },
  );

  await addRelation(db, storno.id, originalId, 'CANCELS');
  await addRelation(db, originalId, storno.id, 'CANCELLED_BY');
  await setStatus(db, originalId, 'CANCELLATION_PENDING');
  await audit(db, { entityType: 'invoice', entityId: storno.id, eventType: 'CANCELLATION_CREATED', actorEmail, metadata: { original: original.invoice_number } });

  const result = await issueInvoice(env, storno.id, `storno-${newId('idem')}`, actorEmail);
  await setStatus(db, originalId, 'CANCELLED');
  return { stornoId: storno.id, invoiceNumber: result.invoiceNumber };
}

/** Create a fresh replacement draft linked to the original + its storno. */
export async function createReplacementDraft(db: D1Database, originalId: string, actorEmail: string): Promise<string> {
  const original = await getInvoice(db, originalId);
  if (!original) throw new AppError('NOT_FOUND');
  const items = await getItems(db, originalId);

  const replacement = await createDraft(db, {
    document_type: 'RECHNUNG',
    customer_id: original.customer_id,
    project_number: original.project_number,
    project_name: original.project_name,
    currency: original.currency,
    tax_scenario: original.tax_scenario,
    customer_snapshot_json: original.customer_snapshot_json,
  });
  await replaceDraftItems(
    db, replacement.id,
    items.map((it, i) => ({
      position: i + 1,
      description: it.description,
      quantity_decimal: it.quantity_decimal,
      unit: it.unit,
      unit_price_cents: it.unit_price_cents,
      discount_cents: it.discount_cents,
      line_total_cents: it.line_total_cents,
      rights_text: it.rights_text,
    })),
    { subtotal: original.subtotal_cents, discount: original.discount_cents, total: original.total_cents },
  );
  await addRelation(db, replacement.id, originalId, 'REPLACES');
  await addRelation(db, originalId, replacement.id, 'REPLACED_BY');
  await audit(db, { entityType: 'invoice', entityId: replacement.id, eventType: 'REPLACEMENT_INVOICE_CREATED', actorEmail, metadata: { original: original.invoice_number } });
  return replacement.id;
}
