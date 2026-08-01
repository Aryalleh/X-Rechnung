import { Hono } from 'hono';
import type { HonoEnv } from '../http-types';
import { ok } from '../lib/response';
import { AppError } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';
import { sniff } from '../lib/file-signature';
import { ingestFile } from '../services/einvoice/ingest';
import { getEInvoiceSettings } from '../services/settings-service';
import {
  listReceivedInvoices, getReceivedInvoice, getReceivedFiles, getReceivedItems, getValidationResults,
} from '../db/repositories/received-repo';
import { run } from '../db/client';
import { audit } from '../services/audit-service';

export const receivedRoutes = new Hono<HonoEnv>();

receivedRoutes.get('/', async (c) => {
  return ok(c, await listReceivedInvoices(c.env.DB));
});

receivedRoutes.get('/:id', async (c) => {
  const inv = await getReceivedInvoice(c.env.DB, c.req.param('id'));
  if (!inv) throw new AppError('NOT_FOUND');
  const [files, items, validations] = await Promise.all([
    getReceivedFiles(c.env.DB, c.req.param('id')),
    getReceivedItems(c.env.DB, c.req.param('id')),
    getValidationResults(c.env.DB, c.req.param('id')),
  ]);
  return ok(c, { invoice: inv, files, items, validations });
});

/** Manual upload of .xml / .pdf / (.eml). Signature-checked; never trusts MIME. */
receivedRoutes.post('/upload', rateLimit({ key: 'upload', limit: 30, windowMs: 60_000 }), async (c) => {
  const settings = await getEInvoiceSettings(c.env.DB);
  if (!settings.inbound_enabled) throw new AppError('CONFLICT', 'inbound e-invoice disabled');

  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new AppError('VALIDATION_ERROR', 'file field required');
  if (file.size > settings.max_file_bytes) throw new AppError('PAYLOAD_TOO_LARGE');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = sniff(bytes);
  if (detected.detected === 'unknown') throw new AppError('UNSUPPORTED_MEDIA', 'unrecognized file signature');
  if (detected.detected === 'zip') throw new AppError('UNSUPPORTED_MEDIA', 'ZIP requires manual security review');

  const result = await ingestFile(c.env, {
    bytes,
    filename: file.name || 'upload',
    declaredMime: file.type || 'application/octet-stream',
    source: 'UPLOAD',
    actorEmail: c.get('actor')!.email,
  });
  return ok(c, result, 201);
});

/** Record a decision on a duplicate warning (accept/reject with reason). */
receivedRoutes.post('/:id/duplicate-decision', async (c) => {
  const { decision, reason } = await c.req.json<{ decision: string; reason: string }>();
  await run(
    c.env.DB,
    `UPDATE received_invoices SET duplicate_decision = ?2 WHERE id = ?1`,
    c.req.param('id'), `${decision}: ${reason}`,
  );
  await audit(c.env.DB, { entityType: 'received_invoice', entityId: c.req.param('id'), eventType: 'DUPLICATE_DECISION', actorEmail: c.get('actor')!.email, metadata: { decision, reason } });
  return ok(c, { saved: true });
});
