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
import { authRoutes } from './routes/auth';
import { publicSignRoutes } from './routes/public-sign';
import { contractRoutes, contractTemplateRoutes } from './routes/contracts';
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
import { mailRoutes } from './routes/mail';
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

// Public (pre-auth) endpoints: setup, login, bootstrap status.
app.route('/api/setup', setupRoutes);
app.route('/api/auth', authRoutes); // /login + /logout public; /me + /password check auth inside
app.route('/api/public/sign', publicSignRoutes); // contract signing by private link token
app.route('/api/system', systemRoutes); // /bootstrap is public; rest behind access inside

// Everything else requires a password session or Cloudflare Access.
app.use('/api/*', requireAccess);
// READ_ONLY users may look but never change anything (own password lives under /api/auth, mounted above).
app.use('/api/*', async (c, next) => {
  if (c.get('actor')?.role === 'READ_ONLY' && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method.toUpperCase())) throw new AppError('FORBIDDEN');
  await next();
});
app.route('/api/settings', settingsRoutes);
app.route('/api/customers', customerRoutes);
app.route('/api/templates', templateRoutes);
app.route('/api/invoices', invoiceRoutes);
app.route('/api/payments', paymentRoutes);
app.route('/api/received', receivedRoutes);
app.route('/api/documents', documentRoutes);
app.route('/api/export', exportRoutes);
app.route('/api/contracts', contractRoutes);
app.route('/api/contract-templates', contractTemplateRoutes);
app.route('/api/mail', mailRoutes);

// Centralized error handler → standardized envelope.
app.onError((err, c) => fail(c, err, c.env.ENVIRONMENT));
app.notFound((c) => fail(c, new AppError('NOT_FOUND'), c.env.ENVIRONMENT));

// Serve the SPA for all non-API routes via the ASSETS binding.
app.get('*', async (c) => {
  if (c.req.path.startsWith('/api/')) {
    return fail(c, new AppError('NOT_FOUND'), c.env.ENVIRONMENT);
  }
  // Re-wrap: ASSETS responses have immutable headers.
  const res = await c.env.ASSETS.fetch(c.req.raw);
  return new Response(res.body, res);
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
