/** Login / logout / current user / change own password. */
import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from '../http-types';
import { ok } from '../lib/response';
import { parseBody } from '../lib/validate-request';
import { AppError } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';
import { requireAccess } from '../middleware/access';
import { audit } from '../services/audit-service';
import { findAdminByEmail } from '../db/repositories/admin-repo';
import { one } from '../db/client';
import {
  assertPasswordPolicy, checkCredentials, createSession, endSession, revokeSessions, setPassword,
} from '../services/auth-service';
import { verifyPassword, PASSWORD_MAX } from '../lib/password';

export const authRoutes = new Hono<HonoEnv>();

authRoutes.post('/login', rateLimit({ key: 'login', limit: 10, windowMs: 60_000 }), async (c) => {
  const body = await parseBody(c, z.object({ email: z.string().trim().email(), password: z.string().min(1).max(PASSWORD_MAX) }));
  const user = await checkCredentials(c.env.DB, body.email, body.password);
  await createSession(c, user);
  await audit(c.env.DB, { entityType: 'admin_user', entityId: user.id, eventType: 'LOGIN_SUCCEEDED', actorEmail: user.email });
  return ok(c, { email: user.email, role: user.role });
});

authRoutes.post('/logout', async (c) => {
  await endSession(c);
  return ok(c, { loggedOut: true });
});

authRoutes.get('/me', requireAccess, async (c) => {
  const actor = c.get('actor')!;
  const admin = await findAdminByEmail(c.env.DB, actor.email);
  return ok(c, { email: actor.email, role: actor.role, fullName: admin?.full_name ?? null, via: actor.via ?? null, hasPassword: Boolean(admin?.has_password), mailAddress: admin?.mail_address ?? null });
});

/** Change own password (requires the current one if a password is set). */
authRoutes.post('/password', requireAccess, rateLimit({ key: 'pwchange', limit: 10, windowMs: 60_000 }), async (c) => {
  const actor = c.get('actor')!;
  const body = await parseBody(c, z.object({ current_password: z.string().max(PASSWORD_MAX).optional(), new_password: z.string().max(PASSWORD_MAX) }));
  const row = await one<{ id: string; password_hash: string | null }>(c.env.DB, `SELECT id, password_hash FROM admin_users WHERE lower(email)=lower(?1)`, actor.email);
  if (!row) throw new AppError('FORBIDDEN');
  if (row.password_hash && !(await verifyPassword(body.current_password ?? '', row.password_hash))) {
    throw new AppError('VALIDATION_ERROR', 'current password wrong', { current_password: 'password_current_wrong' });
  }
  assertPasswordPolicy(body.new_password, actor.email);
  await setPassword(c.env.DB, row.id, body.new_password);
  await revokeSessions(c.env.DB, row.id, actor.sessionId); // sign out other devices
  await audit(c.env.DB, { entityType: 'admin_user', entityId: row.id, eventType: 'PASSWORD_CHANGED', actorEmail: actor.email });
  return ok(c, { changed: true });
});
