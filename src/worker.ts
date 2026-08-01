/**
 * X-Rechnung Worker entry point.
 * Exposes fetch (Hono app), email (inbound E-Rechnung), queue (background),
 * scheduled (daily cron), and the InvoiceSequence Durable Object class.
 */
import { Hono } from 'hono';
import type { HonoEnv } from './http-types';
import type { Env, QueueMessage } from './config/env';
import { newId } from './lib/ids';
import { fail } from './lib/response';
import { AppError } from './lib/errors';
import { securityHeaders, csrfProtection } from './middleware/security';
import { setupGate } from './middleware/setup-gate';
import { requireAccess } from './middleware/access';

import { setupRoutes } from './routes/setup';
import { systemRoutes } from './routes/system';
import { settingsRoutes } from './routes/settings';
import { customerRoutes } from './routes/customers';
import { templateRoutes } from './routes/templates';
import { invoiceRoutes } from './routes/invoices';
import { paymentRoutes } from './routes/payments';
import { receivedRoutes } from './routes/received';
import { documentRoutes } from './routes/documents';
import { exportRoutes } from './routes/export';

import { handleInboundEmail } from './email/inbound';
import { handleQueue } from './queue/consumer';
import { handleScheduled } from './cron';

const app = new Hono<HonoEnv>();

// Request id + security headers on every response.
app.use('*', async (c, next) => {
  c.set('requestId', newId('req'));
  await next();
});
app.use('*', securityHeaders);

// API pipeline.
app.use('/api/*', setupGate);
app.use('/api/*', csrfProtection);

// Public (pre-auth) endpoints: setup + bootstrap status.
app.route('/api/setup', setupRoutes);
app.route('/api/system', systemRoutes); // /bootstrap is public; rest behind access inside

// Everything else requires Cloudflare Access.
app.use('/api/*', requireAccess);
app.route('/api/settings', settingsRoutes);
app.route('/api/customers', customerRoutes);
app.route('/api/templates', templateRoutes);
app.route('/api/invoices', invoiceRoutes);
app.route('/api/payments', paymentRoutes);
app.route('/api/received', receivedRoutes);
app.route('/api/documents', documentRoutes);
app.route('/api/export', exportRoutes);

// Centralized error handler → standardized envelope.
app.onError((err, c) => fail(c, err, c.env.ENVIRONMENT));
app.notFound((c) => fail(c, new AppError('NOT_FOUND'), c.env.ENVIRONMENT));

// Serve the SPA for all non-API routes via the ASSETS binding.
app.get('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  return res;
});

export default {
  fetch: app.fetch,

  async email(message: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleInboundEmail(message as never, env, ctx);
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    await handleQueue(batch, env);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleScheduled(event, env, ctx);
  },
};

export { InvoiceSequence } from './durable-objects/invoice-sequence';
