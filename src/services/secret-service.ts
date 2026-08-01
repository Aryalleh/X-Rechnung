/**
 * Encrypted secret storage. Secrets (KoSIT API key, optionally a Cloudflare
 * API token) are AES-GCM encrypted with DATA_ENCRYPTION_KEY before being
 * written to D1. The raw value is never persisted, never logged, and never
 * returned by any API — only the last four characters are exposed for display.
 *
 * If DATA_ENCRYPTION_KEY is not configured, secret storage is DISABLED and
 * System Status reports it as NOT_CONFIGURED (so nothing is silently stored in
 * the clear).
 */
import type { Env } from '../config/env';
import { one, run } from '../db/client';
import { newId } from '../lib/ids';
import { encryptSecret, decryptSecret } from '../lib/crypto';
import { AppError } from '../lib/errors';

export function secretStorageEnabled(env: Env): boolean {
  return Boolean(env.DATA_ENCRYPTION_KEY);
}

interface SecretRow {
  id: string;
  secret_name: string;
  ciphertext: string;
  iv: string;
  encryption_version: number;
  last_four: string | null;
}

export async function putSecret(env: Env, name: string, plaintext: string): Promise<{ lastFour: string }> {
  if (!env.DATA_ENCRYPTION_KEY) throw new AppError('CONFLICT', 'secret storage disabled (no DATA_ENCRYPTION_KEY)');
  const enc = await encryptSecret(plaintext, env.DATA_ENCRYPTION_KEY);
  const lastFour = plaintext.slice(-4);
  const existing = await one<SecretRow>(env.DB, `SELECT id FROM secret_store WHERE secret_name = ?1`, name);
  if (existing) {
    await run(
      env.DB,
      `UPDATE secret_store SET ciphertext=?2, iv=?3, encryption_version=?4, last_four=?5,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), rotated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id=?1`,
      existing.id, enc.ciphertext, enc.iv, enc.version, lastFour,
    );
  } else {
    await run(
      env.DB,
      `INSERT INTO secret_store (id, secret_name, ciphertext, iv, encryption_version, last_four)
       VALUES (?1,?2,?3,?4,?5,?6)`,
      newId('sec'), name, enc.ciphertext, enc.iv, enc.version, lastFour,
    );
  }
  return { lastFour };
}

export async function getSecret(env: Env, name: string): Promise<string | null> {
  if (!env.DATA_ENCRYPTION_KEY) return null;
  const row = await one<SecretRow>(env.DB, `SELECT * FROM secret_store WHERE secret_name = ?1`, name);
  if (!row) return null;
  await run(env.DB, `UPDATE secret_store SET last_used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1`, row.id);
  return decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, version: row.encryption_version }, env.DATA_ENCRYPTION_KEY);
}

/** Public-safe metadata (last four only). */
export async function describeSecret(env: Env, name: string): Promise<{ configured: boolean; lastFour: string | null }> {
  const row = await one<SecretRow>(env.DB, `SELECT last_four FROM secret_store WHERE secret_name = ?1`, name);
  return { configured: Boolean(row), lastFour: row?.last_four ?? null };
}

export async function deleteSecret(env: Env, name: string): Promise<void> {
  await run(env.DB, `DELETE FROM secret_store WHERE secret_name = ?1`, name);
}
