/** Append-only audit log. No update/delete is ever exposed. */
import { run, all } from '../db/client';
import { newId } from '../lib/ids';

export interface AuditInput {
  entityType: string;
  entityId?: string | null;
  eventType: string;
  actorEmail?: string | null;
  requestId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: unknown;
}

/** Fields that must never be written into audit payloads verbatim. */
const REDACT_KEYS = new Set([
  'api_token', 'apiToken', 'token', 'setup_token', 'setupToken', 'password',
  'encryption_key', 'ciphertext', 'iv', 'kosit_api_key', 'secret',
]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.has(k) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
}

export async function audit(db: D1Database, input: AuditInput): Promise<void> {
  await run(
    db,
    `INSERT INTO audit_events
       (id, entity_type, entity_id, event_type, actor_email, request_id,
        old_value_json, new_value_json, metadata_json)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
    newId('aud'),
    input.entityType,
    input.entityId ?? null,
    input.eventType,
    input.actorEmail ?? null,
    input.requestId ?? null,
    input.oldValue === undefined ? null : JSON.stringify(redact(input.oldValue)),
    input.newValue === undefined ? null : JSON.stringify(redact(input.newValue)),
    input.metadata === undefined ? null : JSON.stringify(redact(input.metadata)),
  );
}

export interface AuditEvent {
  id: string;
  entity_type: string;
  entity_id: string | null;
  event_type: string;
  actor_email: string | null;
  created_at: string;
  metadata_json: string | null;
}

export function listAudit(db: D1Database, limit = 200): Promise<AuditEvent[]> {
  return all<AuditEvent>(
    db,
    `SELECT id, entity_type, entity_id, event_type, actor_email, created_at, metadata_json
       FROM audit_events ORDER BY created_at DESC LIMIT ?1`,
    limit,
  );
}
