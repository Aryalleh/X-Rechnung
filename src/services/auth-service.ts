/**
 * Password login + server-side sessions.
 *
 * - The session cookie holds a random 256-bit token; D1 stores only its
 *   SHA-256 (admin_sessions.id), so DB contents cannot be replayed.
 * - Cookie: HttpOnly, Secure (on https), SameSite=Strict, path /.
 * - Sessions expire after SESSION_TTL; they are revoked on logout, on
 *   password change/reset and when the user is disabled.
 * - Brute force: per-isolate rate limit on the route + a persistent per-account
 *   lockout (MAX_FAILED attempts → LOCK_MINUTES).
 */
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { HonoEnv, Actor } from '../http-types';
import { one, run } from '../db/client';
import { sha256Hex } from '../lib/crypto';
import { randomToken } from '../lib/ids';
import { hashPassword, verifyPassword, passwordProblem } from '../lib/password';
import { AppError } from '../lib/errors';
import { audit } from './audit-service';
import type { AdminUser } from '../db/repositories/admin-repo';

export const SESSION_COOKIE = 'xr_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

interface Credential { id: string; email: string; role: AdminUser['role']; status: AdminUser['status']; password_hash: string | null; failed_logins: number; locked_until: string | null }

// Used when the e-mail is unknown, so timing does not reveal which accounts exist.
const DUMMY_HASH = 'pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export function assertPasswordPolicy(password: string, email?: string): void {
  const problem = passwordProblem(password, email);
  if (problem) throw new AppError('VALIDATION_ERROR', problem, { password: problem });
}

export async function setPassword(db: D1Database, userId: string, password: string): Promise<void> {
  const hash = await hashPassword(password);
  await run(db, `UPDATE admin_users SET password_hash = ?2, password_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      failed_logins = 0, locked_until = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`, userId, hash);
}

export async function revokeSessions(db: D1Database, userId: string, exceptSessionId?: string): Promise<void> {
  if (exceptSessionId) await run(db, `DELETE FROM admin_sessions WHERE admin_user_id = ?1 AND id <> ?2`, userId, exceptSessionId);
  else await run(db, `DELETE FROM admin_sessions WHERE admin_user_id = ?1`, userId);
}

/** Verify e-mail + password; returns the user or throws a generic UNAUTHORIZED. */
export async function checkCredentials(db: D1Database, email: string, password: string): Promise<Credential> {
  const u = await one<Credential>(db,
    `SELECT id, email, role, status, password_hash, failed_logins, locked_until FROM admin_users WHERE lower(email) = lower(?1)`, email);
  if (u?.locked_until && Date.parse(u.locked_until) > Date.now()) {
    throw new AppError('RATE_LIMITED', 'account temporarily locked', { _: 'login_locked' });
  }
  const valid = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH);
  if (!u || !valid || u.status !== 'ACTIVE') {
    if (u) {
      const failed = u.failed_logins + 1;
      const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
      await run(db, `UPDATE admin_users SET failed_logins = ?2, locked_until = ?3 WHERE id = ?1`, u.id, lock ? 0 : failed, lock);
      await audit(db, { entityType: 'admin_user', entityId: u.id, eventType: lock ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', actorEmail: u.email });
    }
    throw new AppError('UNAUTHORIZED', 'invalid credentials', { _: 'login_invalid' });
  }
  return u;
}

export async function createSession(c: Context<HonoEnv>, user: { id: string; email: string }): Promise<void> {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await run(c.env.DB, `INSERT INTO admin_sessions (id, admin_user_id, email, csrf_token, expires_at, last_seen_at)
      VALUES (?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`, id, user.id, user.email, randomToken(16), expires);
  await run(c.env.DB, `UPDATE admin_users SET failed_logins = 0, locked_until = NULL, last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`, user.id);
  // Opportunistic cleanup of expired sessions.
  await run(c.env.DB, `DELETE FROM admin_sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/** Resolve the session cookie to an actor, or null. */
export async function sessionActor(c: Context<HonoEnv>): Promise<(Actor & { userId: string; sessionId: string }) | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || token.length > 128) return null;
  const id = await sha256Hex(token);
  const row = await one<{ admin_user_id: string; email: string; role: Actor['role']; status: string; expires_at: string }>(c.env.DB,
    `SELECT s.admin_user_id, u.email, u.role, u.status, s.expires_at
       FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_user_id WHERE s.id = ?1`, id);
  if (!row || row.status !== 'ACTIVE' || Date.parse(row.expires_at) < Date.now()) return null;
  return { email: row.email, role: row.role, userId: row.admin_user_id, sessionId: id };
}

export async function endSession(c: Context<HonoEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await run(c.env.DB, `DELETE FROM admin_sessions WHERE id = ?1`, await sha256Hex(token));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}
