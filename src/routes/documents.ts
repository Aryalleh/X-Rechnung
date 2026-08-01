/** Authenticated file downloads. R2 is private — files are only served here
 * behind Access, never via a public bucket URL. */
import { Hono } from 'hono';
import type { HonoEnv } from '../http-types';
import { AppError } from '../lib/errors';
import { getDocument, listDocuments } from '../db/repositories/document-repo';
import { getReceivedFiles } from '../db/repositories/received-repo';
import { fetchObject } from '../services/archive-service';
import { audit } from '../services/audit-service';
import { ok } from '../lib/response';

export const documentRoutes = new Hono<HonoEnv>();

documentRoutes.get('/for/:entityType/:entityId', async (c) => {
  const docs = await listDocuments(c.env.DB, c.req.param('entityType'), c.req.param('entityId'));
  return ok(c, docs);
});

documentRoutes.get('/:id/download', async (c) => {
  const doc = await getDocument(c.env.DB, c.req.param('id'));
  if (!doc) throw new AppError('NOT_FOUND');
  const obj = await fetchObject(c.env.ARCHIVE_BUCKET, doc.r2_key);
  if (!obj) throw new AppError('NOT_FOUND', 'object missing in R2');
  await audit(c.env.DB, { entityType: doc.entity_type, entityId: doc.entity_id, eventType: 'FILE_DOWNLOADED', actorEmail: c.get('actor')!.email, metadata: { documentId: doc.id, sha256: doc.sha256 } });
  return new Response(obj.body, {
    headers: {
      'content-type': doc.mime_type ?? 'application/octet-stream',
      'content-disposition': `attachment; filename="${doc.original_filename ?? doc.id}"`,
      'x-content-sha256': doc.sha256 ?? '',
      'cache-control': 'private, no-store',
    },
  });
});

/** Download a received-invoice file (source XML / PDF / raw EML). */
documentRoutes.get('/received/:receivedId/file/:role', async (c) => {
  const files = await getReceivedFiles(c.env.DB, c.req.param('receivedId'));
  const file = files.find((f) => f.file_role === c.req.param('role')) as { r2_key: string; mime_type: string; original_filename: string; sha256: string } | undefined;
  if (!file) throw new AppError('NOT_FOUND');
  const obj = await fetchObject(c.env.ARCHIVE_BUCKET, file.r2_key);
  if (!obj) throw new AppError('NOT_FOUND');
  await audit(c.env.DB, { entityType: 'received_invoice', entityId: c.req.param('receivedId'), eventType: 'FILE_DOWNLOADED', actorEmail: c.get('actor')!.email, metadata: { role: c.req.param('role') } });
  return new Response(obj.body, {
    headers: {
      'content-type': file.mime_type ?? 'application/octet-stream',
      'content-disposition': `attachment; filename="${file.original_filename}"`,
      'cache-control': 'private, no-store',
    },
  });
});
