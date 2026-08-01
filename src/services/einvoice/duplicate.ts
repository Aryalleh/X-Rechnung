/** Duplicate detection for received invoices. Never auto-deletes. */
import { one } from '../../db/client';
import type { ExtractedInvoice } from './parse';

export type DuplicateLevel = 'EXACT_DUPLICATE' | 'POSSIBLE_DUPLICATE' | 'NOT_DUPLICATE';

export interface DuplicateResult {
  level: DuplicateLevel;
  matchId: string | null;
  reason: string | null;
}

/**
 * EXACT: identical file SHA-256, OR same supplier tax/vat id + invoice number
 *        + gross amount + currency.
 * POSSIBLE: same supplier name + invoice number (weaker signal).
 */
export async function detectDuplicate(
  db: D1Database,
  x: ExtractedInvoice,
  fileSha256: string,
  excludeId?: string,
): Promise<DuplicateResult> {
  const exclude = excludeId ?? '';

  const byHash = await one<{ id: string }>(
    db,
    `SELECT id FROM received_invoices WHERE file_sha256 = ?1 AND id <> ?2 LIMIT 1`,
    fileSha256, exclude,
  );
  if (byHash) return { level: 'EXACT_DUPLICATE', matchId: byHash.id, reason: 'file_sha256 match' };

  const supplierId = x.supplierVatId || x.supplierTaxId;
  if (supplierId && x.invoiceNumber && x.grossAmountCents !== null) {
    const exact = await one<{ id: string }>(
      db,
      `SELECT id FROM received_invoices
        WHERE id <> ?5 AND invoice_number = ?1 AND gross_amount_cents = ?2 AND currency = ?3
          AND (supplier_vat_id = ?4 OR supplier_tax_id = ?4) LIMIT 1`,
      x.invoiceNumber, x.grossAmountCents, x.currency ?? 'EUR', supplierId, exclude,
    );
    if (exact) return { level: 'EXACT_DUPLICATE', matchId: exact.id, reason: 'supplier+number+amount match' };
  }

  if (x.supplierName && x.invoiceNumber) {
    const possible = await one<{ id: string }>(
      db,
      `SELECT id FROM received_invoices
        WHERE id <> ?3 AND supplier_name = ?1 AND invoice_number = ?2 LIMIT 1`,
      x.supplierName, x.invoiceNumber, exclude,
    );
    if (possible) return { level: 'POSSIBLE_DUPLICATE', matchId: possible.id, reason: 'supplier name + number match' };
  }

  return { level: 'NOT_DUPLICATE', matchId: null, reason: null };
}
