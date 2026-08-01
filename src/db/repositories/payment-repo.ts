import { one, all, run } from '../client';
import { newId } from '../../lib/ids';

export interface Payment {
  id: string;
  invoice_id: string;
  payment_date: string;
  amount_cents: number;
  payment_method: string;
  bank_reference: string | null;
  note: string | null;
  created_at: string;
}

export function listPayments(db: D1Database, invoiceId: string): Promise<Payment[]> {
  return all<Payment>(db, `SELECT * FROM payments WHERE invoice_id = ?1 ORDER BY payment_date`, invoiceId);
}

export async function sumPayments(db: D1Database, invoiceId: string): Promise<number> {
  const row = await one<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(amount_cents),0) AS total FROM payments WHERE invoice_id = ?1`,
    invoiceId,
  );
  return row?.total ?? 0;
}

export async function insertPayment(
  db: D1Database,
  input: Omit<Payment, 'id' | 'created_at'>,
): Promise<Payment> {
  const id = newId('pay');
  await run(
    db,
    `INSERT INTO payments (id, invoice_id, payment_date, amount_cents, payment_method, bank_reference, note)
     VALUES (?1,?2,?3,?4,?5,?6,?7)`,
    id, input.invoice_id, input.payment_date, input.amount_cents, input.payment_method,
    input.bank_reference ?? null, input.note ?? null,
  );
  return (await one<Payment>(db, `SELECT * FROM payments WHERE id = ?1`, id))!;
}

/** Sum of payments received in a calendar period (by payment_date) — for EÜR-style reports. */
export function paymentsInRange(db: D1Database, from: string, to: string) {
  return all<{ payment_date: string; amount_cents: number; invoice_id: string }>(
    db,
    `SELECT payment_date, amount_cents, invoice_id FROM payments
      WHERE payment_date >= ?1 AND payment_date <= ?2 ORDER BY payment_date`,
    from, to,
  );
}
