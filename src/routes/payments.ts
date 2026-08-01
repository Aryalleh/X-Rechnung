import { Hono } from 'hono';
import type { HonoEnv } from '../http-types';
import { ok } from '../lib/response';
import { parseBody } from '../lib/validate-request';
import { paymentSchema } from '../lib/schemas';
import { recordPayment, getPaymentSummary } from '../services/payment-service';

export const paymentRoutes = new Hono<HonoEnv>();

paymentRoutes.get('/:invoiceId', async (c) => {
  return ok(c, await getPaymentSummary(c.env.DB, c.req.param('invoiceId')));
});

paymentRoutes.post('/:invoiceId', async (c) => {
  const body = await parseBody(c, paymentSchema);
  const result = await recordPayment(c.env.DB, c.req.param('invoiceId'), body, c.get('actor')!.email);
  return ok(c, result, 201);
});
