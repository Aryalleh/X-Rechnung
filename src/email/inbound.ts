/**
 * Cloudflare Email Worker handler for inbound E-Rechnung.
 *
 * Steps: read the raw RFC822 message, archive it immutably as .eml, extract
 * headers, parse MIME, archive each attachment, then enqueue processing so
 * parsing/validation happens off the request path.
 */
import type { Env, QueueMessage } from '../config/env';
import { sha256Hex } from '../lib/crypto';
import { berlinToday } from '../lib/format';
import { newId } from '../lib/ids';
import { run } from '../db/client';
import { storeImmutable } from '../services/archive-service';
import { audit } from '../services/audit-service';
import { parseEmail } from './mime';
import { ingestFile } from '../services/einvoice/ingest';
import { UPLOAD_LIMITS } from '../config/constants';
import { mailSettings, storeInbound } from '../services/mail-service';

interface CfEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
}

const CANDIDATE_TYPES = new Set(['application/xml', 'text/xml', 'application/pdf', 'application/octet-stream']);
const CANDIDATE_EXT = /\.(xml|pdf)$/i;

export async function handleInboundEmail(message: CfEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
  if (message.rawSize > UPLOAD_LIMITS.maxEmailBytes) {
    message.setReject('Message too large');
    return;
  }

  // Read raw bytes.
  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
  const rawSha = await sha256Hex(raw);
  const today = berlinToday();
  const emailId = newId('eml');

  await run(
    env.DB,
    `INSERT INTO received_emails (id, message_id, from_email, to_email, subject, raw_sha256, size_bytes, status)
     VALUES (?1,?2,?3,?4,?5,?6,?7,'PROCESSING')`,
    emailId, message.headers.get('message-id'), message.from, message.to,
    message.headers.get('subject'), rawSha, raw.byteLength,
  );

  // Archive raw .eml.
  const storedEml = await storeImmutable({
    db: env.DB, bucket: env.ARCHIVE_BUCKET, area: 'email', date: today,
    entityType: 'received_email', entityId: emailId, documentRole: 'raw_eml',
    filename: `${emailId}.eml`, mimeType: 'message/rfc822', body: raw,
  });
  await run(env.DB, `UPDATE received_emails SET raw_r2_key = ?2 WHERE id = ?1`, emailId, storedEml.r2Key);
  await audit(env.DB, { entityType: 'received_email', entityId: emailId, eventType: 'EMAIL_RECEIVED', metadata: { from: message.from, sha256: rawSha } });

  const parsed = parseEmail(raw);
  const settings = await mailSettings(env.DB);

  // Mailbox copy: every message lands in the INBOX (never blocks e-invoice intake).
  let mailId: string | null = null;
  try {
    mailId = await storeInbound(env, { parsed, envelopeFrom: message.from, envelopeTo: message.to, size: raw.byteLength, rawKey: storedEml.r2Key, receivedEmailId: emailId });
  } catch (err) {
    await run(env.DB, `INSERT INTO job_failures (id, job_type, entity_type, entity_id, error_text) VALUES (?1,'STORE_MAIL','received_email',?2,?3)`,
      newId('job'), emailId, err instanceof Error ? err.message : String(err));
  }
  // Optional copy to a personal mailbox (must be a verified Email Routing destination).
  if (settings.forwardTo) ctx.waitUntil(message.forward(settings.forwardTo).catch(() => undefined));

  // E-invoice intake: only mail sent to the invoice addresses when those are configured, otherwise every message.
  const rcpt = message.to.toLowerCase();
  if (settings.invoiceAddresses.length && !settings.invoiceAddresses.includes(rcpt)) {
    await run(env.DB, `UPDATE received_emails SET status = 'PROCESSED' WHERE id = ?1`, emailId);
    return;
  }

  // Parse MIME and ingest each candidate attachment.
  let ingested = 0;
  for (const part of parsed.parts) {
    const isCandidate =
      (part.filename && CANDIDATE_EXT.test(part.filename)) ||
      CANDIDATE_TYPES.has(part.contentType);
    if (!isCandidate || part.body.byteLength === 0) continue;
    if (part.body.byteLength > UPLOAD_LIMITS.maxAttachmentBytes) continue;

    try {
      const res = await ingestFile(env, {
        bytes: part.body,
        filename: part.filename ?? `attachment-${ingested + 1}`,
        declaredMime: part.contentType,
        source: 'EMAIL',
        receivedEmailId: emailId,
      });
      await audit(env.DB, { entityType: 'received_email', entityId: emailId, eventType: 'ATTACHMENT_ARCHIVED', metadata: { filename: part.filename } });
      if (mailId && res.receivedInvoiceId && ingested === 0) {
        await run(env.DB, `UPDATE mail_messages SET related_type='received_invoice', related_id=?2 WHERE id=?1`, mailId, res.receivedInvoiceId);
      }
      ingested++;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await run(
        env.DB,
        `INSERT INTO job_failures (id, job_type, entity_type, entity_id, error_text) VALUES (?1,'INGEST_ATTACHMENT','received_email',?2,?3)`,
        newId('job'), emailId, detail,
      );
    }
  }

  await run(env.DB, `UPDATE received_emails SET status = 'PROCESSED' WHERE id = ?1`, emailId);
  // Enqueue a follow-up marker (idempotent no-op consumer for now / future hooks).
  ctx.waitUntil(env.DOCUMENT_QUEUE.send({ type: 'PROCESS_RECEIVED_EMAIL', receivedEmailId: emailId } satisfies QueueMessage));
}
