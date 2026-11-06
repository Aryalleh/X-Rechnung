/** Contracts + contract templates (authenticated). */
import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from '../http-types';
import { ok } from '../lib/response';
import { toArrayBuffer } from '../lib/crypto';
import { parseBody } from '../lib/validate-request';
import { AppError } from '../lib/errors';
import { all, one, run } from '../db/client';
import { newId } from '../lib/ids';
import { requireRole } from '../middleware/access';
import {
  cancelContract, contractPdfHtml, contractView, createContract, deleteDraftContract, duplicateContract,
  countersignContract, ensureSignedPdf, getContract, listContracts, relinkContract, sendContract, updateContract,
} from '../services/contract-service';
import { generatePdf } from '../services/pdf/renderer';

export const contractRoutes = new Hono<HonoEnv>();
const editors = requireRole('OWNER', 'ADMIN');
const lang = z.enum(['de', 'en', 'fa']);
const contractSchema = z.object({
  title: z.string().trim().min(1).max(200),
  language: lang.default('de'),
  template_id: z.string().nullable().optional(),
  customer_id: z.string().nullable().optional(),
  body: z.string().min(1).max(100_000),
  variables: z.record(z.string().max(5000)).default({}),
});
const origin = (url: string) => new URL(url).origin;

contractRoutes.get('/', async (c) => ok(c, await listContracts(c.env.DB)));
contractRoutes.post('/', editors, async (c) => {
  const body = await parseBody(c, contractSchema);
  return ok(c, contractView(await createContract(c.env.DB, body, c.get('actor')!.email)), 201);
});
contractRoutes.get('/:id', async (c) => ok(c, contractView(await getContract(c.env.DB, c.req.param('id')))));
contractRoutes.put('/:id', editors, async (c) => {
  const body = await parseBody(c, contractSchema);
  return ok(c, contractView(await updateContract(c.env.DB, c.req.param('id'), body, c.get('actor')!.email)));
});
contractRoutes.delete('/:id', editors, async (c) => {
  await deleteDraftContract(c.env.DB, c.req.param('id'), c.get('actor')!.email);
  return ok(c, { deleted: true });
});

contractRoutes.post('/:id/send', editors, async (c) => {
  const body = await parseBody(c, z.object({
    email_to: z.string().email().optional().or(z.literal('')),
    message: z.string().max(4000).optional(),
    link_days: z.number().int().min(1).max(90).optional(),
  }));
  const r = await sendContract(c.env, c.req.param('id'), { ...body, email_to: body.email_to || null, origin: origin(c.req.url) }, c.get('actor')!.email);
  return ok(c, r);
});
// Provider countersigns after the customer has signed.
contractRoutes.post('/:id/countersign', editors, async (c) => {
  const body = await parseBody(c, z.object({
    seller_signer_name: z.string().trim().min(1).max(200),
    seller_signature: z.string().max(300_000),
  }));
  const r = await countersignContract(c.env, c.req.param('id'), { ...body, origin: origin(c.req.url) }, c.get('actor')!.email,
    (p) => { try { c.executionCtx.waitUntil(p); } catch { /* no ctx in tests */ } });
  return ok(c, r);
});
contractRoutes.post('/:id/relink', editors, async (c) => ok(c, await relinkContract(c.env, c.req.param('id'), origin(c.req.url), c.get('actor')!.email)));
contractRoutes.post('/:id/cancel', editors, async (c) => { await cancelContract(c.env.DB, c.req.param('id'), c.get('actor')!.email); return ok(c, { cancelled: true }); });
contractRoutes.post('/:id/duplicate', editors, async (c) => ok(c, contractView(await duplicateContract(c.env.DB, c.req.param('id'), c.get('actor')!.email)), 201));

/** PDF: the archived signed copy, or a DRAFT-watermarked preview before signing. */
contractRoutes.get('/:id/pdf', async (c) => {
  const contract = await getContract(c.env.DB, c.req.param('id'));
  const { bytes, filename } = contract.status === 'SIGNED'
    ? await ensureSignedPdf(c.env, contract.id)
    : { bytes: await generatePdf(c.env, await contractPdfHtml(c.env.DB, contract)), filename: `${contract.contract_number}_preview.pdf` };
  return new Response(toArrayBuffer(bytes), { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${filename}"` } });
});

// ───────── templates ─────────
export const contractTemplateRoutes = new Hono<HonoEnv>();
const tplSchema = z.object({
  name: z.string().trim().min(1).max(200),
  language: lang.default('de'),
  body: z.string().min(1).max(100_000),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});
contractTemplateRoutes.get('/', async (c) => {
  const l = c.req.query('language');
  const rows = l && ['de', 'en', 'fa'].includes(l)
    ? await all(c.env.DB, `SELECT * FROM contract_templates WHERE language=?1 ORDER BY sort_order, name`, l)
    : await all(c.env.DB, `SELECT * FROM contract_templates ORDER BY language, sort_order, name`);
  return ok(c, rows);
});
contractTemplateRoutes.post('/', editors, async (c) => {
  const b = await parseBody(c, tplSchema);
  const id = newId('ctpl');
  await run(c.env.DB, `INSERT INTO contract_templates (id, name, language, body, is_active, sort_order) VALUES (?1,?2,?3,?4,?5,?6)`,
    id, b.name, b.language, b.body, b.is_active ? 1 : 0, b.sort_order);
  return ok(c, await one(c.env.DB, `SELECT * FROM contract_templates WHERE id=?1`, id), 201);
});
contractTemplateRoutes.put('/:id', editors, async (c) => {
  const b = await parseBody(c, tplSchema);
  const r = await run(c.env.DB, `UPDATE contract_templates SET name=?2, language=?3, body=?4, is_active=?5, sort_order=?6, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1`,
    c.req.param('id'), b.name, b.language, b.body, b.is_active ? 1 : 0, b.sort_order);
  if (!r.meta.changes) throw new AppError('NOT_FOUND');
  return ok(c, await one(c.env.DB, `SELECT * FROM contract_templates WHERE id=?1`, c.req.param('id')));
});
contractTemplateRoutes.delete('/:id', editors, async (c) => {
  await run(c.env.DB, `DELETE FROM contract_templates WHERE id=?1`, c.req.param('id'));
  return ok(c, { deleted: true });
});
