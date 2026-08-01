import { Hono } from 'hono';
import type { HonoEnv } from '../http-types';
import { ok } from '../lib/response';
import { AppError } from '../lib/errors';
import { parseBody } from '../lib/validate-request';
import { serviceTemplateSchema } from '../lib/schemas';
import { all, one, run } from '../db/client';
import { newId } from '../lib/ids';

export const templateRoutes = new Hono<HonoEnv>();

interface Template {
  id: string; name: string; default_description: string; unit: string;
  default_price_cents: number; category: string | null; is_active: number; sort_order: number;
}

templateRoutes.get('/', async (c) => {
  const activeOnly = c.req.query('active') === '1';
  const rows = activeOnly
    ? await all<Template>(c.env.DB, `SELECT * FROM service_templates WHERE is_active=1 ORDER BY sort_order, name`)
    : await all<Template>(c.env.DB, `SELECT * FROM service_templates ORDER BY sort_order, name`);
  return ok(c, rows);
});

templateRoutes.post('/', async (c) => {
  const body = await parseBody(c, serviceTemplateSchema);
  const id = newId('tpl');
  await run(
    c.env.DB,
    `INSERT INTO service_templates (id, name, default_description, unit, default_price_cents, category, is_active, sort_order)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`,
    id, body.name, body.default_description, body.unit, body.default_price_cents, body.category ?? null,
    body.is_active ? 1 : 0, body.sort_order,
  );
  return ok(c, await one(c.env.DB, `SELECT * FROM service_templates WHERE id=?1`, id), 201);
});

templateRoutes.put('/:id', async (c) => {
  const body = await parseBody(c, serviceTemplateSchema);
  const id = c.req.param('id');
  const existing = await one(c.env.DB, `SELECT id FROM service_templates WHERE id=?1`, id);
  if (!existing) throw new AppError('NOT_FOUND');
  await run(
    c.env.DB,
    `UPDATE service_templates SET name=?2, default_description=?3, unit=?4, default_price_cents=?5,
       category=?6, is_active=?7, sort_order=?8, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1`,
    id, body.name, body.default_description, body.unit, body.default_price_cents, body.category ?? null,
    body.is_active ? 1 : 0, body.sort_order,
  );
  return ok(c, await one(c.env.DB, `SELECT * FROM service_templates WHERE id=?1`, id));
});
