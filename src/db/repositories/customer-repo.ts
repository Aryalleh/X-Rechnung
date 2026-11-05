import { one, all, run } from '../client';
import { newId, formatCustomerCode } from '../../lib/ids';
import { rankCustomers } from '../../lib/search';

export interface Customer {
  id: string;
  customer_code: string;
  customer_type: 'BUSINESS' | 'PRIVATE';
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  contact_person: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  ust_idnr: string | null;
  steuernummer: string | null;
  national_id: string | null;
  economic_code: string | null;
  leitweg_id: string | null;
  buyer_reference: string | null;
  order_reference: string | null;
  payment_days: number | null;
  invoice_language: string;
  delivery_method: string;
  internal_note: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export function getCustomerById(db: D1Database, id: string): Promise<Customer | null> {
  return one<Customer>(db, `SELECT * FROM customers WHERE id = ?1`, id);
}

export function getCustomerByCode(db: D1Database, code: string): Promise<Customer | null> {
  return one<Customer>(db, `SELECT * FROM customers WHERE customer_code = ?1`, code);
}

/**
 * Smart search: loads the (small, single-tenant) customer table and ranks it
 * in memory with typo tolerance + German/Persian normalization.
 */
export async function searchCustomers(db: D1Database, q: string, limit = 20): Promise<Customer[]> {
  const rows = await all<Customer>(db, `SELECT * FROM customers LIMIT 5000`);
  return rankCustomers(q, rows, limit);
}

/** Customers most recently invoiced (then newest), for an empty search box. */
export function recentCustomers(db: D1Database, limit = 8): Promise<Customer[]> {
  return all<Customer>(
    db,
    `SELECT c.* FROM customers c
       LEFT JOIN (SELECT customer_id, MAX(created_at) AS last_inv FROM invoices GROUP BY customer_id) i
         ON i.customer_id = c.id
      WHERE c.is_active = 1
      ORDER BY i.last_inv IS NULL, i.last_inv DESC, c.created_at DESC
      LIMIT ?1`,
    limit,
  );
}

export function listCustomers(db: D1Database, activeOnly = false): Promise<Customer[]> {
  const sql = activeOnly
    ? `SELECT * FROM customers WHERE is_active = 1 ORDER BY customer_code`
    : `SELECT * FROM customers ORDER BY customer_code`;
  return all<Customer>(db, sql);
}

/** Next auto customer code (KD-0001, ...). */
export async function nextCustomerCode(db: D1Database): Promise<string> {
  const rows = await all<{ customer_code: string }>(
    db,
    `SELECT customer_code FROM customers WHERE customer_code LIKE 'KD-%'`,
  );
  let max = 0;
  for (const r of rows) {
    const m = /^KD-(\d+)$/.exec(r.customer_code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return formatCustomerCode(max + 1);
}

export type CustomerInput = Omit<Customer, 'id' | 'created_at' | 'updated_at'>;

export async function insertCustomer(db: D1Database, input: CustomerInput): Promise<Customer> {
  const id = newId('cust');
  await run(
    db,
    `INSERT INTO customers
       (id, customer_code, customer_type, company_name, first_name, last_name, contact_person,
        street, postal_code, city, country, email, phone, ust_idnr, steuernummer, leitweg_id,
        buyer_reference, order_reference, payment_days, invoice_language, delivery_method,
        internal_note, is_active, national_id, economic_code)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)`,
    id, input.customer_code, input.customer_type, input.company_name, input.first_name, input.last_name,
    input.contact_person, input.street, input.postal_code, input.city, input.country, input.email, input.phone,
    input.ust_idnr, input.steuernummer, input.leitweg_id, input.buyer_reference, input.order_reference,
    input.payment_days, input.invoice_language, input.delivery_method, input.internal_note, input.is_active,
    input.national_id, input.economic_code,
  );
  return (await getCustomerById(db, id))!;
}

export async function updateCustomer(db: D1Database, id: string, input: CustomerInput): Promise<Customer> {
  await run(
    db,
    `UPDATE customers SET
       customer_code=?2, customer_type=?3, company_name=?4, first_name=?5, last_name=?6, contact_person=?7,
       street=?8, postal_code=?9, city=?10, country=?11, email=?12, phone=?13, ust_idnr=?14, steuernummer=?15,
       leitweg_id=?16, buyer_reference=?17, order_reference=?18, payment_days=?19, invoice_language=?20,
       delivery_method=?21, internal_note=?22, is_active=?23, national_id=?24, economic_code=?25,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id=?1`,
    id, input.customer_code, input.customer_type, input.company_name, input.first_name, input.last_name,
    input.contact_person, input.street, input.postal_code, input.city, input.country, input.email, input.phone,
    input.ust_idnr, input.steuernummer, input.leitweg_id, input.buyer_reference, input.order_reference,
    input.payment_days, input.invoice_language, input.delivery_method, input.internal_note, input.is_active,
    input.national_id, input.economic_code,
  );
  return (await getCustomerById(db, id))!;
}
