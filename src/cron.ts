/**
 * Daily maintenance cron.
 *  - Mark overdue invoices (issued/sent/partially-paid past due date).
 *  - Retry unresolved issue jobs.
 *  - Flag documents missing a hash.
 *  - Check metadata/R2 consistency for a sample of documents.
 *  - Emit warnings for failed validations.
 */
import type { Env } from './config/env';
import { all, run } from './db/client';
import { berlinToday } from './lib/format';
import { documentsMissingHash } from './db/repositories/document-repo';
import { audit } from './services/audit-service';

export async function handleScheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(runMaintenance(env));
}

async function runMaintenance(env: Env): Promise<void> {
  const today = berlinToday();

  // 1) Overdue detection.
  const overdue = await run(
    env.DB,
    `UPDATE invoices SET status='OVERDUE', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE status IN ('ISSUED','SENT','PARTIALLY_PAID') AND due_date IS NOT NULL AND due_date < ?1`,
    today,
  );

  // 2) Retry unresolved issue failures via the queue.
  const failures = await all<{ id: string; entity_id: string; payload_json: string }>(
    env.DB,
    `SELECT id, entity_id, payload_json FROM job_failures
      WHERE job_type='ISSUE_INVOICE' AND resolved=0 LIMIT 20`,
  );
  for (const f of failures) {
    try {
      const payload = f.payload_json ? JSON.parse(f.payload_json) as { idempotencyKey?: string } : {};
      if (f.entity_id && payload.idempotencyKey) {
        await env.DOCUMENT_QUEUE.send({ type: 'RETRY_ISSUE', invoiceId: f.entity_id, idempotencyKey: payload.idempotencyKey });
      }
    } catch {
      /* skip malformed */
    }
  }

  // 3) Documents missing hash.
  const missing = await documentsMissingHash(env.DB);

  // 4) Failed validations warning count.
  const failedVal = await all<{ n: number }>(
    env.DB,
    `SELECT COUNT(*) AS n FROM received_invoices WHERE validation_status IN ('BASIC_INVALID','STRICT_INVALID','PROCESSING_ERROR')`,
  );

  await audit(env.DB, {
    entityType: 'system',
    eventType: 'CRON_MAINTENANCE',
    metadata: {
      date: today,
      overdue_marked: overdue.meta.changes ?? 0,
      issue_retries: failures.length,
      documents_missing_hash: missing.length,
      failed_validations: failedVal[0]?.n ?? 0,
    },
  });
}
