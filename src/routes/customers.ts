import { Hono } from 'hono';
import type { HonoEnv } from '../http-types';
import { ok } from '../lib/response';
import { AppError } from '../lib/errors';
import { parseBody } from '../lib/validate-request';
import { customerSchema } from '../lib/schemas';
import {
  listCustomers, searchCustomers, recentCustomers, getCustomerById, getCustomerByCode, nextCustomerCode,
} from '../db/repositories/customer-repo';
import { createCustomer, editCustomer } from '../services/customer-service';
import { sumPayments } from '../db/repositories/payment-repo';
import { all } from '../db/client';
import { audit } from '../services/audit-service';

export const customerRoutes = new Hono<HonoEnv>();

customerRoutes.get('/', async (c) => {
  const q = c.req.query('q');
  const rows = q ? await searchCustomers(c.env.DB, q, 500) : await listCustomers(c.env.DB);
  return ok(c, rows);
});

/** Smart search for pickers: ranked, typo-tolerant; empty q = recent customers. */
customerRoutes.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const limit = Math.min(Number(c.req.query('limit') ?? 8) || 8, 50);
  return ok(c, q ? await searchCustomers(c.env.DB, q, limit) : await recentCustomers(c.env.DB, limit));
});

customerRoutes.get('/next-code', async (c) => ok(c, { code: await nextCustomerCode(c.env.DB) }));

/** Quick lookup by exact code (used by the fast-invoice flow). */
customerRoutes.get('/by-code/:code', async (c) => {
  const cust = await getCustomerByCode(c.env.DB, c.req.param('code'));
  if (!cust) throw new AppError('CUSTOMER_NOT_FOUND');
  return ok(c, cust);
});

customerRoutes.get('/:id', async (c) => {
  const cust = await getCustomerById(c.env.DB, c.req.param('id'));
  if (!cust) throw new AppError('NOT_FOUND');
  const invoices = await all<{ id: string; invoice_number: string | null; status: string; total_cents: number }>(
    c.env.DB,
    `SELECT id, invoice_number, status, total_cents FROM invoices WHERE customer_id = ?1 ORDER BY created_at DESC`,
    cust.id,
  );
  let paid = 0;
  let open = 0;
  for (const inv of invoices) {
    const p = await sumPayments(c.env.DB, inv.id);
    paid += p;
    if (!['CANCELLED', 'DRAFT'].includes(inv.status)) open += inv.total_cents - p;
  }
  return ok(c, { customer: cust, invoices, paidCents: paid, openCents: open });
});

customerRoutes.post('/', async (c) => {
  const body = await parseBody(c, customerSchema);
  const created = await createCustomer(c.env.DB, body, c.get('actor')!.email);
  return ok(c, created, 201);
});

customerRoutes.put('/:id', async (c) => {
  const body = await parseBody(c, customerSchema);
  const updated = await editCustomer(c.env.DB, c.req.param('id'), body, c.get('actor')!.email);
  return ok(c, updated);
});

/** CSV export of customers. */
customerRoutes.get('/export/csv', async (c) => {
  const rows = await listCustomers(c.env.DB);
  const header = 'customer_code,customer_type,company_name,last_name,email,city,country,is_active';
  const lines = rows.map((r) =>
    [r.customer_code, r.customer_type, r.company_name, r.last_name, r.email, r.city, r.country, r.is_active]
      .map(csvCell).join(','),
  );
  await audit(c.env.DB, { entityType: 'customer', eventType: 'EXPORT_CREATED', actorEmail: c.get('actor')!.email, metadata: { kind: 'customers_csv', count: rows.length } });
  return c.body([header, ...lines].join('\n'), 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="customers.csv"',
  });
});

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
