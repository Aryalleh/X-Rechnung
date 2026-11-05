/**
 * Setup lifecycle.
 *
 * No setup secret: the FIRST person to submit the owner form becomes OWNER.
 * At that moment a random "setup claim" is issued to that browser as an
 * HttpOnly cookie (only its SHA-256 hash is stored in setup_state), so the
 * remaining wizard steps can't be hijacked and no second owner can be created
 * while setup is in progress. Completing setup clears the claim and closes
 * /api/setup for good.
 */
import type { Env } from '../config/env';
import { one, run } from '../db/client';
import { sha256Hex, timingSafeEqual } from '../lib/crypto';
import { randomToken } from '../lib/ids';
import { audit } from './audit-service';

export interface SetupStateRow {
  id: number;
  state: 'SETUP_REQUIRED' | 'IN_PROGRESS' | 'ACTIVE' | 'RECOVERY';
  setup_token_hash: string | null;
  setup_token_used_at: string | null;
  setup_attempts: number;
}

const MAX_SETUP_ATTEMPTS = 10;

export async function getSetupRow(db: D1Database): Promise<SetupStateRow | null> {
  return one<SetupStateRow>(db, `SELECT * FROM setup_state WHERE id = 1`);
}

/** Ensure a setup_state row exists. Returns the current lifecycle state. */
export async function ensureSetupState(
  env: Env,
  _ctx?: { waitUntil(p: Promise<unknown>): void },
): Promise<SetupStateRow['state']> {
  const existing = await getSetupRow(env.DB);
  if (existing) return existing.state;
  await run(env.DB, `INSERT OR IGNORE INTO setup_state (id, state) VALUES (1, 'SETUP_REQUIRED')`);
  await audit(env.DB, { entityType: 'setup', eventType: 'INITIAL_SETUP_STARTED' });
  return (await getSetupRow(env.DB))?.state ?? 'SETUP_REQUIRED';
}

/**
 * Atomically claim setup. Succeeds if nobody claimed it yet, or if a previous
 * claim never produced an owner. Returns the raw claim value for the browser,
 * or null if an owner already exists.
 */
export async function claimSetup(db: D1Database): Promise<string | null> {
  const raw = randomToken(32);
  const hash = await sha256Hex(raw);
  const res = await db
    .prepare(
      `UPDATE setup_state
          SET setup_token_hash = ?1,
              setup_token_created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              state = 'IN_PROGRESS',
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = 1
          AND state IN ('SETUP_REQUIRED','IN_PROGRESS')
          -- unclaimed, or claimed but no owner was ever created (abandoned/failed attempt)
          AND (setup_token_hash IS NULL OR NOT EXISTS (SELECT 1 FROM admin_users))`,
    )
    .bind(hash)
    .run();
  return (res.meta.changes ?? 0) === 1 ? raw : null;
}

/** Does this claim value belong to the browser that started setup? */
export async function verifySetupClaim(db: D1Database, claim: string | undefined): Promise<boolean> {
  if (!claim) return false;
  const row = await getSetupRow(db);
  if (!row || !row.setup_token_hash) return false;
  return timingSafeEqual(await sha256Hex(claim), row.setup_token_hash);
}

export async function markInProgress(db: D1Database): Promise<void> {
  await run(db, `UPDATE setup_state SET state = 'IN_PROGRESS', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1`);
}

/** Complete setup: invalidate the token and close /setup. */
export async function completeSetup(env: Env, actorEmail: string): Promise<void> {
  await run(
    env.DB,
    `UPDATE setup_state
       SET state = 'ACTIVE',
           setup_token_hash = NULL,
           setup_token_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = 1`,
  );
  await audit(env.DB, { entityType: 'setup', eventType: 'INITIAL_SETUP_COMPLETED', actorEmail });
}
