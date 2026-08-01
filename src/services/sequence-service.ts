/** Client for the InvoiceSequence Durable Object + D1 mirror. */
import type { Env } from '../config/env';
import { run } from '../db/client';
import { newId } from '../lib/ids';

export interface Allocation {
  sequence: number;
  formatted: string;
  state: 'RESERVED' | 'CONFIRMED' | 'VOID';
  invoiceId?: string;
  idempotencyKey?: string;
}

function stub(env: Env, prefix: string, year: number): DurableObjectStub {
  const id = env.INVOICE_SEQUENCE.idFromName(`${prefix}:${year}`);
  return env.INVOICE_SEQUENCE.get(id);
}

async function call(s: DurableObjectStub, action: string, body: unknown): Promise<Allocation> {
  const res = await s.fetch(`https://do/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`sequence ${action} failed: ${res.status} ${text}`);
  }
  return res.json<Allocation>();
}

export async function reserveNumber(
  env: Env,
  opts: { prefix: string; year: number; digits: number; invoiceId: string; idempotencyKey: string },
): Promise<Allocation> {
  const alloc = await call(stub(env, opts.prefix, opts.year), 'reserve', opts);
  await mirror(env.DB, opts.prefix, opts.year, alloc, opts.idempotencyKey);
  return alloc;
}

export async function confirmNumber(env: Env, prefix: string, year: number, sequence: number): Promise<Allocation> {
  const alloc = await call(stub(env, prefix, year), 'confirm', { sequence });
  await run(
    env.DB,
    `UPDATE sequence_allocations SET state='CONFIRMED', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE prefix=?1 AND year=?2 AND sequence_number=?3`,
    prefix, year, sequence,
  );
  return alloc;
}

export async function voidNumber(
  env: Env,
  prefix: string,
  year: number,
  sequence: number,
  reason: string,
): Promise<void> {
  await call(stub(env, prefix, year), 'void', { sequence, reason });
  await run(
    env.DB,
    `UPDATE sequence_allocations SET state='VOID', void_reason=?4, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE prefix=?1 AND year=?2 AND sequence_number=?3`,
    prefix, year, sequence, reason,
  );
}

async function mirror(
  db: D1Database,
  prefix: string,
  year: number,
  alloc: Allocation,
  idempotencyKey: string,
): Promise<void> {
  await run(
    db,
    `INSERT INTO sequence_allocations (id, prefix, year, sequence_number, formatted, state, invoice_id, idempotency_key)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
     ON CONFLICT(prefix, year, sequence_number) DO NOTHING`,
    newId('seq'), prefix, year, alloc.sequence, alloc.formatted, alloc.state,
    alloc.invoiceId ?? null, idempotencyKey,
  );
}
