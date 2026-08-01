/**
 * Setup lifecycle.
 *
 * Nothing is hardcoded — not even the bootstrap token. On first contact the
 * system generates a one-time setup token, stores ONLY its SHA-256 hash in
 * setup_state, and logs the raw token exactly once. The operator retrieves it
 * from the Worker log (`wrangler tail`) or the deploy output and enters it in
 * the /setup wizard. The raw token is never persisted and never returned by
 * any API.
 */
import type { Env } from '../config/env';
import { one, run } from '../db/client';
import { sha256Hex, timingSafeEqual } from '../lib/crypto';
import { setupToken } from '../lib/ids';
import { AppError } from '../lib/errors';
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

/**
 * Ensure a setup_state row exists. On the very first call, generate the
 * one-time token and log it once. Returns the current lifecycle state.
 */
export async function ensureSetupState(
  env: Env,
  ctx?: { waitUntil(p: Promise<unknown>): void },
): Promise<SetupStateRow['state']> {
  const existing = await getSetupRow(env.DB);
  if (existing) return existing.state;

  const raw = setupToken();
  const hash = await sha256Hex(raw);
  await run(
    env.DB,
    `INSERT INTO setup_state (id, state, setup_token_hash, setup_token_created_at)
     VALUES (1, 'SETUP_REQUIRED', ?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    hash,
  );

  // Log the raw token exactly once. This is the ONLY time it is available.
  const banner =
    `\n============================================================\n` +
    ` X-RECHNUNG FIRST-RUN SETUP TOKEN (shown once):\n\n   ${raw}\n\n` +
    ` Open the app and go to /setup, then paste this token.\n` +
    `============================================================\n`;
  const logPromise = Promise.resolve().then(() => console.log(banner));
  if (ctx) ctx.waitUntil(logPromise);
  else await logPromise;

  await audit(env.DB, { entityType: 'setup', eventType: 'INITIAL_SETUP_STARTED' });
  return 'SETUP_REQUIRED';
}

/** Verify a submitted setup token against the stored hash (constant time). */
export async function verifySetupToken(db: D1Database, token: string): Promise<boolean> {
  const row = await getSetupRow(db);
  if (!row || !row.setup_token_hash) return false;
  if (row.setup_attempts >= MAX_SETUP_ATTEMPTS) {
    throw new AppError('RATE_LIMITED', 'setup attempts exhausted');
  }
  const hash = await sha256Hex(token);
  const okToken = timingSafeEqual(hash, row.setup_token_hash);
  if (!okToken) {
    await run(db, `UPDATE setup_state SET setup_attempts = setup_attempts + 1 WHERE id = 1`);
  }
  return okToken;
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
