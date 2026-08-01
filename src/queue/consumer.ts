/** Queue consumer for background document processing. */
import type { Env, QueueMessage } from '../config/env';
import { newId } from '../lib/ids';
import { run } from '../db/client';
import { issueInvoice } from '../services/issue-service';

export async function handleQueue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await handleOne(message.body, env);
      message.ack();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await run(
        env.DB,
        `INSERT INTO job_failures (id, job_type, entity_type, error_text, payload_json, attempt)
         VALUES (?1,?2,'queue',?3,?4,?5)`,
        newId('job'), message.body.type, detail, JSON.stringify(message.body), message.attempts,
      ).catch(() => {});
      // Retry with backoff (Queue handles redelivery up to max_retries).
      message.retry({ delaySeconds: Math.min(60, 2 ** message.attempts) });
    }
  }
}

async function handleOne(msg: QueueMessage, env: Env): Promise<void> {
  switch (msg.type) {
    case 'PROCESS_RECEIVED_EMAIL':
      // Attachments are already ingested synchronously in the Email Worker.
      // This hook exists for future re-processing / re-validation.
      return;
    case 'RETRY_ISSUE':
      await issueInvoice(env, msg.invoiceId, msg.idempotencyKey, 'system@queue');
      return;
    case 'PROCESS_RECEIVED_INVOICE':
    case 'VALIDATE_RECEIVED_INVOICE':
    case 'SEND_INVOICE_EMAIL':
      // Reserved for future async flows.
      return;
    default: {
      const _exhaustive: never = msg;
      void _exhaustive;
    }
  }
}
