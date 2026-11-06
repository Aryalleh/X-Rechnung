/** Built-in mailbox API: folders, read, flags, compose/reply/forward, attachments, DNS status. */
import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from '../http-types';
import { ok } from '../lib/response';
import { AppError } from '../lib/errors';
import { run } from '../db/client';
import { requireRole } from '../middleware/access';
import { rateLimit } from '../middleware/rate-limit';
import { ingestFile } from '../services/einvoice/ingest';
import {
  FOLDERS, attachmentsOf, canSee, getMail, listMail, mailCounts, mailSettings, mailStatus, purgeMail, scopeFor, sendMail, senderAddresses,
} from '../services/mail-service';
import type { Context } from 'hono';

const scope = (c: Context<HonoEnv>) => scopeFor(c.env.DB, c.get('actor')!);
const MAIL_ROLES = ['OWNER', 'ADMIN', 'ACCOUNTANT', 'MAIL_USER'] as const;

export const mailRoutes = new Hono<HonoEnv>();

mailRoutes.get('/', async (c) => {
  const folder = (c.req.query('folder') ?? 'INBOX').toUpperCase();
  if (folder !== 'STARRED' && !FOLDERS.includes(folder as never)) throw new AppError('VALIDATION_ERROR', 'unknown folder');
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0);
  return ok(c, await listMail(c.env.DB, await scope(c), { folder: folder as never, q: c.req.query('q')?.trim() || undefined, limit, offset }));
});

mailRoutes.get('/counts', async (c) => ok(c, await mailCounts(c.env.DB, await scope(c))));

mailRoutes.get('/status', async (c) => {
  const [status, s, sc] = await Promise.all([mailStatus(c.env), mailSettings(c.env.DB), scope(c)]);
  const role = c.get('actor')!.role;
  const canManage = role === 'OWNER' || role === 'ADMIN';
  return ok(c, { ...status, senders: senderAddresses(s, sc), settings: canManage ? s : null, me: { address: sc.own, canManage, shared: sc.shared } });
});

mailRoutes.get('/:id', async (c) => {
  const m = await getMail(c.env.DB, c.req.param('id'), await scope(c));
  const [attachments, thread] = await Promise.all([
    attachmentsOf(c.env.DB, m.id),
    c.env.DB.prepare(`SELECT id, mailbox, direction, from_email, from_name, subject, snippet, created_at, status FROM mail_messages
      WHERE thread_id=?1 AND id != ?2 AND folder != 'TRASH' ORDER BY created_at`).bind(m.thread_id, m.id).all<{ mailbox: string | null }>(),
  ]);
  const sc = await scope(c);
  thread.results = thread.results.filter((x) => canSee(sc, x.mailbox));
  if (!m.is_read && c.get('actor')?.role !== 'READ_ONLY') await run(c.env.DB, `UPDATE mail_messages SET is_read=1 WHERE id=?1`, m.id);
  const { html_body, ...rest } = m;
  return ok(c, { ...rest, is_read: 1, has_html: !!html_body, attachments, thread: thread.results });
});

/** The HTML body, served under a sandbox CSP (no scripts, no forms; remote images only on request). */
mailRoutes.get('/:id/html', async (c) => {
  const m = await getMail(c.env.DB, c.req.param('id'), await scope(c));
  const remote = c.req.query('images') === '1';
  let html = m.html_body ?? '';
  // Inline images (cid:) → this mailbox's attachment URLs.
  const atts = await attachmentsOf(c.env.DB, m.id);
  for (const a of atts) if (a.content_id) html = html.split(`cid:${a.content_id}`).join(`/api/mail/${m.id}/attachments/${a.id}`);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px;line-height:1.5;color:#1f2937;margin:16px;word-wrap:break-word}img{max-width:100%;height:auto}</style>
</head><body>${html}</body></html>`;
  return new Response(doc, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Mail-Csp': [
        "default-src 'none'", `img-src 'self' data:${remote ? ' https: http:' : ''}`, "style-src 'unsafe-inline'", "font-src data:",
        "frame-ancestors 'self'", "form-action 'none'", "base-uri 'none'",
      ].join('; '),
    },
  });
});

mailRoutes.get('/:id/attachments/:att', async (c) => {
  const m = await getMail(c.env.DB, c.req.param('id'), await scope(c));
  const att = (await attachmentsOf(c.env.DB, m.id)).find((a) => a.id === c.req.param('att'));
  if (!att) throw new AppError('NOT_FOUND');
  const obj = await c.env.ARCHIVE_BUCKET.get(att.r2_key);
  if (!obj) throw new AppError('NOT_FOUND');
  // Images may display inline (mail HTML); everything else downloads.
  const inline = /^image\/(png|jpe?g|gif|webp)$/.test(att.mime_type) && c.req.query('download') !== '1';
  return new Response(obj.body, {
    headers: {
      'Content-Type': inline ? att.mime_type : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

mailRoutes.get('/:id/raw', async (c) => {
  const m = await getMail(c.env.DB, c.req.param('id'), await scope(c));
  if (!m.raw_r2_key) throw new AppError('NOT_FOUND');
  const obj = await c.env.ARCHIVE_BUCKET.get(m.raw_r2_key);
  if (!obj) throw new AppError('NOT_FOUND');
  return new Response(obj.body, { headers: { 'Content-Type': 'message/rfc822', 'Content-Disposition': `attachment; filename="${m.id}.eml"` } });
});

const patchSchema = z.object({
  is_read: z.boolean().optional(), is_starred: z.boolean().optional(), folder: z.enum(FOLDERS).optional(),
});
mailRoutes.patch('/:id', async (c) => {
  const m = await getMail(c.env.DB, c.req.param('id'), await scope(c));
  const b = patchSchema.parse(await c.req.json());
  if (b.folder === 'SENT' && m.direction !== 'OUT') throw new AppError('VALIDATION_ERROR', 'only sent mail belongs in SENT');
  if (b.folder === 'INBOX' && m.direction !== 'IN') throw new AppError('VALIDATION_ERROR', 'only received mail belongs in INBOX');
  await run(c.env.DB, `UPDATE mail_messages SET is_read=coalesce(?2,is_read), is_starred=coalesce(?3,is_starred), folder=coalesce(?4,folder) WHERE id=?1`,
    m.id, b.is_read === undefined ? null : b.is_read ? 1 : 0, b.is_starred === undefined ? null : b.is_starred ? 1 : 0, b.folder ?? null);
  return ok(c, { id: m.id });
});

/** Bulk flag/move for the list toolbar. */
mailRoutes.post('/bulk', async (c) => {
  const b = z.object({ ids: z.array(z.string()).min(1).max(200) }).merge(patchSchema).parse(await c.req.json());
  const sc = await scope(c);
  for (const id of b.ids) {
    try { await getMail(c.env.DB, id, sc); } catch { continue; }
    await run(c.env.DB, `UPDATE mail_messages SET is_read=coalesce(?2,is_read), is_starred=coalesce(?3,is_starred),
      folder=CASE WHEN ?4 IS NULL THEN folder WHEN ?4='INBOX' AND direction!='IN' THEN 'SENT' WHEN ?4='SENT' AND direction!='OUT' THEN 'INBOX' ELSE ?4 END WHERE id=?1`,
    id, b.is_read === undefined ? null : b.is_read ? 1 : 0, b.is_starred === undefined ? null : b.is_starred ? 1 : 0, b.folder ?? null);
  }
  return ok(c, { updated: b.ids.length });
});

/** Move to trash; a message already in trash is deleted for good. */
mailRoutes.delete('/:id', requireRole(...MAIL_ROLES), async (c) => {
  const m = await getMail(c.env.DB, c.req.param('id'), await scope(c));
  if (m.folder === 'TRASH') { await purgeMail(c.env, m.id); return ok(c, { deleted: true }); }
  await run(c.env.DB, `UPDATE mail_messages SET folder='TRASH' WHERE id=?1`, m.id);
  return ok(c, { deleted: false });
});

const sendSchema = z.object({
  from: z.string().email().optional(),
  to: z.string().min(3).max(2000),
  cc: z.string().max(2000).optional(),
  bcc: z.string().max(2000).optional(),
  subject: z.string().max(400),
  text: z.string().max(200_000),
  attachments: z.array(z.object({ filename: z.string().min(1).max(255), mime: z.string().max(200), data: z.string() })).max(20).optional(),
  reply_to_id: z.string().optional(),
  forward_id: z.string().optional(),
});
mailRoutes.post('/send', requireRole(...MAIL_ROLES), rateLimit({ key: 'mail-send', limit: 30, windowMs: 600_000 }), async (c) => {
  const body = sendSchema.parse(await c.req.json());
  const emailish = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
  for (const field of ['to', 'cc', 'bcc'] as const) {
    for (const a of (body[field] ?? '').split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
      if (!emailish.test(/<([^>]+)>/.exec(a)?.[1] ?? a)) throw new AppError('VALIDATION_ERROR', 'invalid address', { [field]: 'invalid' });
    }
  }
  const res = await sendMail(c.env, body, c.get('actor')!.email, await scope(c));
  return ok(c, res, res.status === 'SENT' ? 201 : 202);
});

/** Import an attachment as an incoming e-invoice (same pipeline as upload). */
mailRoutes.post('/:id/attachments/:att/import', requireRole('OWNER', 'ADMIN', 'ACCOUNTANT'), async (c) => {
  const m = await getMail(c.env.DB, c.req.param('id'), await scope(c));
  const att = (await attachmentsOf(c.env.DB, m.id)).find((a) => a.id === c.req.param('att'));
  if (!att) throw new AppError('NOT_FOUND');
  const obj = await c.env.ARCHIVE_BUCKET.get(att.r2_key);
  if (!obj) throw new AppError('NOT_FOUND');
  const res = await ingestFile(c.env, {
    bytes: new Uint8Array(await obj.arrayBuffer()), filename: att.filename, declaredMime: att.mime_type,
    source: 'EMAIL', ...(m.received_email_id ? { receivedEmailId: m.received_email_id } : {}), actorEmail: c.get('actor')!.email,
  });
  if (res.receivedInvoiceId) await run(c.env.DB, `UPDATE mail_messages SET related_type='received_invoice', related_id=?2 WHERE id=?1`, m.id, res.receivedInvoiceId);
  return ok(c, res, 201);
});
