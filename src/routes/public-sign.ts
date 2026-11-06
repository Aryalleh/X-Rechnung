/**
 * Public contract signing (no login): the random link token is the credential.
 * Rate-limited; CSRF middleware still applies to the POST.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from '../http-types';
import { ok } from '../lib/response';
import { toArrayBuffer } from '../lib/crypto';
import { parseBody } from '../lib/validate-request';
import { rateLimit } from '../middleware/rate-limit';
import { openForSigning, signContract, signedPdfByToken } from '../services/contract-service';

export const publicSignRoutes = new Hono<HonoEnv>();
const ip = (h: (n: string) => string | undefined) => h('CF-Connecting-IP') ?? null;

publicSignRoutes.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex');
});

publicSignRoutes.get('/:token', rateLimit({ key: 'sign-view', limit: 60, windowMs: 60_000 }), async (c) =>
  ok(c, await openForSigning(c.env.DB, c.req.param('token'), ip((n) => c.req.header(n)))));

publicSignRoutes.post('/:token', rateLimit({ key: 'sign-submit', limit: 10, windowMs: 60_000 }), async (c) => {
  const body = await parseBody(c, z.object({
    signer_name: z.string().trim().min(2).max(200),
    signer_email: z.string().email().optional().or(z.literal('')),
    signature: z.string().max(300_000),
    values: z.record(z.union([z.string().max(500), z.boolean()])).default({}),
    consent: z.literal(true, { errorMap: () => ({ message: 'consent_required' }) }),
  }));
  const r = await signContract(c.env, c.req.param('token'), body,
    { ip: ip((n) => c.req.header(n)), ua: c.req.header('User-Agent') ?? null },
    (p) => c.executionCtx.waitUntil(p));
  return ok(c, r);
});

publicSignRoutes.get('/:token/pdf', rateLimit({ key: 'sign-pdf', limit: 20, windowMs: 60_000 }), async (c) => {
  const { bytes, filename } = await signedPdfByToken(c.env, c.req.param('token'));
  return new Response(toArrayBuffer(bytes), { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store' } });
});
