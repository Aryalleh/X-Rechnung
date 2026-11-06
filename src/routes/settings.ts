/** Admin settings API — everything the operator configures lives here. */
import { Hono } from 'hono';
import type { HonoEnv } from '../http-types';
import { z } from 'zod';
import { ok } from '../lib/response';
import { AppError } from '../lib/errors';
import { parseBody } from '../lib/validate-request';
import { requireRole } from '../middleware/access';
import { sellerProfileSchema, emailChannelSchema } from '../lib/schemas';
import { getGroup, setSetting } from '../db/repositories/settings-repo';
import { getGeneralSettings, getInvoiceSettings, getEInvoiceSettings } from '../services/settings-service';
import { saveSellerProfile } from '../services/seller-service';
import { assertPasswordPolicy, revokeSessions, setPassword } from '../services/auth-service';
import { PASSWORD_MAX } from '../lib/password';
import { getActiveSeller, listSellerVersions } from '../db/repositories/seller-repo';
import {
  listAdmins, createAdmin, updateAdminRole, setAdminStatus, countActiveOwners, findAdminByEmail,
} from '../db/repositories/admin-repo';
import { getIntegration, upsertIntegration } from '../db/repositories/cloudflare-repo';
import { putSecret, describeSecret, deleteSecret, secretStorageEnabled } from '../services/secret-service';
import { all, run, one } from '../db/client';
import { newId } from '../lib/ids';
import { audit } from '../services/audit-service';
import * as cfApi from '../services/cloudflare-api-service';

export const settingsRoutes = new Hono<HonoEnv>();

// ------------------------------- General --------------------------------
settingsRoutes.get('/general', async (c) => ok(c, await getGeneralSettings(c.env.DB)));
settingsRoutes.put('/general', async (c) => {
  const body = await parseBody(c, z.record(z.unknown()));
  const email = c.get('actor')!.email;
  const groups: Record<string, string> = {
    app_name: 'GENERAL', logo: 'GENERAL', theme: 'GENERAL', base_url: 'GENERAL',
    locale: 'LOCALIZATION', invoice_language: 'LOCALIZATION', timezone: 'LOCALIZATION',
    date_format: 'LOCALIZATION', currency: 'LOCALIZATION', country: 'LOCALIZATION',
  };
  for (const [key, value] of Object.entries(body)) {
    const group = (groups[key] ?? 'GENERAL') as 'GENERAL' | 'LOCALIZATION';
    await setSetting(c.env.DB, group, key, value, { updatedBy: email });
  }
  await audit(c.env.DB, { entityType: 'settings', eventType: 'SETTING_UPDATED', actorEmail: email, metadata: { group: 'GENERAL', keys: Object.keys(body) } });
  return ok(c, await getGeneralSettings(c.env.DB));
});

// ------------------------------- Invoice --------------------------------
settingsRoutes.get('/invoice', async (c) => ok(c, await getInvoiceSettings(c.env.DB)));
settingsRoutes.put('/invoice', async (c) => {
  const body = await parseBody(c, z.record(z.unknown()).and(z.object({ confirm_tax_replace: z.boolean().optional() })));
  const email = c.get('actor')!.email;

  // §19 guard: in Kleinunternehmer mode the tax text may not be emptied, and
  // replacing it (or dropping the §19 reference) requires explicit confirmation.
  if ('tax_exemption_text' in body) {
    const text = String(body.tax_exemption_text ?? '');
    if (!text.trim()) throw new AppError('VALIDATION_ERROR', 'tax text cannot be empty', { tax_exemption_text: 'tax_text_required' });
    if (!/§\s*19/.test(text) && !body.confirm_tax_replace) {
      throw new AppError('VALIDATION_ERROR', 'removing §19 reference requires confirmation', { tax_exemption_text: 'tax_text_19_confirm' });
    }
  }
  const { confirm_tax_replace: _c, ...rest } = body as Record<string, unknown>;
  for (const [key, value] of Object.entries(rest)) {
    await setSetting(c.env.DB, 'INVOICE', key, value, { updatedBy: email });
  }
  await audit(c.env.DB, { entityType: 'settings', eventType: 'SETTING_UPDATED', actorEmail: email, metadata: { group: 'INVOICE', keys: Object.keys(rest) } });
  return ok(c, await getInvoiceSettings(c.env.DB));
});

// ------------------------------- Seller ---------------------------------
settingsRoutes.get('/seller', async (c) => ok(c, await getActiveSeller(c.env.DB)));
settingsRoutes.get('/seller/versions', async (c) => ok(c, await listSellerVersions(c.env.DB)));
settingsRoutes.post('/seller', async (c) => {
  const body = await parseBody(c, sellerProfileSchema);
  const profile = await saveSellerProfile(c.env.DB, body, c.get('actor')!.email);
  return ok(c, profile, 201);
});

// ------------------------------ E-Invoice -------------------------------
settingsRoutes.get('/einvoice', async (c) => {
  const settings = await getEInvoiceSettings(c.env.DB);
  const kositKey = await describeSecret(c.env, 'kosit_api_key');
  return ok(c, { ...settings, kosit_api_key: kositKey, secret_storage_enabled: secretStorageEnabled(c.env) });
});
settingsRoutes.put('/einvoice', async (c) => {
  const body = await parseBody(c, z.record(z.unknown()));
  const email = c.get('actor')!.email;
  for (const [key, value] of Object.entries(body)) {
    if (key === 'kosit_api_key') {
      if (value === null || value === '') { await deleteSecret(c.env, 'kosit_api_key'); continue; }
      if (!secretStorageEnabled(c.env)) throw new AppError('CONFLICT', 'secret storage disabled (no DATA_ENCRYPTION_KEY)');
      await putSecret(c.env, 'kosit_api_key', String(value));
      await audit(c.env.DB, { entityType: 'settings', eventType: 'SECRET_UPDATED', actorEmail: email, metadata: { secret: 'kosit_api_key' } });
      continue;
    }
    await setSetting(c.env.DB, 'EINVOICE', key, value, { updatedBy: email });
  }
  return ok(c, await getEInvoiceSettings(c.env.DB));
});

// ------------------------------- Users ----------------------------------
settingsRoutes.get('/users', async (c) => ok(c, await listAdmins(c.env.DB)));
settingsRoutes.post('/users', requireRole('OWNER'), async (c) => {
  const body = await parseBody(c, z.object({ email: z.string().email(), full_name: z.string().optional(), role: z.enum(['ADMIN', 'ACCOUNTANT', 'READ_ONLY']), password: z.string().max(PASSWORD_MAX).optional().or(z.literal('')) }));
  if (body.password) assertPasswordPolicy(body.password, body.email);
  if (await findAdminByEmail(c.env.DB, body.email)) throw new AppError('CONFLICT', 'user exists', { email: 'user_exists' });
  const created = await createAdmin(c.env.DB, { email: body.email, role: body.role, ...(body.full_name ? { full_name: body.full_name } : {}) });
  if (body.password) await setPassword(c.env.DB, created.id, body.password);
  await audit(c.env.DB, { entityType: 'admin_user', entityId: created.id, eventType: 'ADMIN_USER_CREATED', actorEmail: c.get('actor')!.email, metadata: { role: body.role } });
  return ok(c, created, 201);
});
settingsRoutes.put('/users/:id/role', requireRole('OWNER'), async (c) => {
  const body = await parseBody(c, z.object({ role: z.enum(['OWNER', 'ADMIN', 'ACCOUNTANT', 'READ_ONLY']) }));
  // Ownership only moves through the verified transfer flow; an owner is never demoted here.
  const target = await one<{ role: string }>(c.env.DB, `SELECT role FROM admin_users WHERE id=?1`, c.req.param('id'));
  if (!target) throw new AppError('NOT_FOUND');
  if (body.role === 'OWNER' || target.role === 'OWNER') throw new AppError('CONFLICT', 'use the ownership transfer to change the owner');
  await updateAdminRole(c.env.DB, c.req.param('id'), body.role);
  await audit(c.env.DB, { entityType: 'admin_user', entityId: c.req.param('id'), eventType: 'ADMIN_ROLE_CHANGED', actorEmail: c.get('actor')!.email, metadata: { from: target.role, to: body.role } });
  return ok(c, { updated: true });
});
/** Owner sets / resets another user's password; signs that user out everywhere. */
settingsRoutes.put('/users/:id/password', requireRole('OWNER'), async (c) => {
  const body = await parseBody(c, z.object({ password: z.string().max(PASSWORD_MAX) }));
  const target = await one<{ id: string; email: string }>(c.env.DB, `SELECT id, email FROM admin_users WHERE id=?1`, c.req.param('id'));
  if (!target) throw new AppError('NOT_FOUND');
  assertPasswordPolicy(body.password, target.email);
  await setPassword(c.env.DB, target.id, body.password);
  const actor = c.get('actor')!;
  await revokeSessions(c.env.DB, target.id, target.email === actor.email ? actor.sessionId : undefined);
  await audit(c.env.DB, { entityType: 'admin_user', entityId: target.id, eventType: 'PASSWORD_RESET', actorEmail: actor.email });
  return ok(c, { updated: true });
});

settingsRoutes.put('/users/:id/status', requireRole('OWNER'), async (c) => {
  const body = await parseBody(c, z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }));
  // Never disable the last active owner.
  const target = await one<{ role: string }>(c.env.DB, `SELECT role FROM admin_users WHERE id=?1`, c.req.param('id'));
  if (target?.role === 'OWNER' && body.status === 'DISABLED') {
    const owners = await countActiveOwners(c.env.DB);
    if (owners <= 1) throw new AppError('CONFLICT', 'cannot disable the last owner');
  }
  await setAdminStatus(c.env.DB, c.req.param('id'), body.status);
  if (body.status === 'DISABLED') await revokeSessions(c.env.DB, c.req.param('id'));
  await audit(c.env.DB, { entityType: 'admin_user', entityId: c.req.param('id'), eventType: body.status === 'DISABLED' ? 'ADMIN_USER_DISABLED' : 'ADMIN_USER_ENABLED', actorEmail: c.get('actor')!.email });
  return ok(c, { updated: true });
});

/**
 * Ownership transfer (safe change: add new -> verify -> activate -> demote old).
 * Access policy is synced with the new email BEFORE the role moves, so the old
 * owner is never locked out before the new one is confirmed.
 */
settingsRoutes.post('/users/transfer-owner', requireRole('OWNER'), async (c) => {
  const body = await parseBody(c, z.object({ new_owner_email: z.string().email(), api_token: z.string().optional() }));
  const actor = c.get('actor')!.email;
  const cf = await getIntegration(c.env.DB);

  // 1) Ensure the new user exists in D1.
  let newUser = await findAdminByEmail(c.env.DB, body.new_owner_email);
  if (!newUser) newUser = await createAdmin(c.env.DB, { email: body.new_owner_email, role: 'ADMIN' });

  // 2) Sync Access policy to include both emails (new one added, old kept for now).
  if (body.api_token && cf?.access_application_id && cf.access_policy_id && cf.account_id) {
    const admins = await listAdmins(c.env.DB);
    const emails = Array.from(new Set([...admins.filter((a) => a.status === 'ACTIVE').map((a) => a.email), body.new_owner_email]));
    await cfApi.updateOwnerPolicy(body.api_token, cf.account_id, cf.access_application_id, cf.access_policy_id, emails);
    await audit(c.env.DB, { entityType: 'cloudflare', eventType: 'ACCESS_POLICY_UPDATED', actorEmail: actor, metadata: { added: body.new_owner_email } });
  }

  await audit(c.env.DB, { entityType: 'admin_user', entityId: newUser.id, eventType: 'OWNER_EMAIL_CHANGE_REQUESTED', actorEmail: actor, metadata: { new_owner: body.new_owner_email } });
  return ok(c, {
    status: 'PENDING_LOGIN_TEST',
    message: 'کاربر جدید باید یک ورود آزمایشی موفق انجام دهد؛ سپس مالکیت منتقل می‌شود.',
    newUserId: newUser.id,
  });
});

/** Finalize ownership transfer after the new owner has logged in successfully. */
settingsRoutes.post('/users/confirm-owner', requireRole('OWNER'), async (c) => {
  const body = await parseBody(c, z.object({ new_owner_id: z.string(), demote_previous: z.boolean().default(true) }));
  const actor = c.get('actor')!.email;
  const target = await one<{ id: string; last_login_at: string | null }>(c.env.DB, `SELECT id, last_login_at FROM admin_users WHERE id=?1`, body.new_owner_id);
  if (!target) throw new AppError('NOT_FOUND');
  if (!target.last_login_at) throw new AppError('CONFLICT', 'new owner has not completed a test login');

  await updateAdminRole(c.env.DB, body.new_owner_id, 'OWNER');
  if (body.demote_previous) {
    const me = await findAdminByEmail(c.env.DB, actor);
    if (me) await updateAdminRole(c.env.DB, me.id, 'ADMIN');
  }
  await audit(c.env.DB, { entityType: 'admin_user', entityId: body.new_owner_id, eventType: 'OWNERSHIP_TRANSFERRED', actorEmail: actor });
  return ok(c, { transferred: true });
});

// ------------------------------ Domains ---------------------------------
settingsRoutes.get('/domains', async (c) => ok(c, await all(c.env.DB, `SELECT * FROM managed_domains ORDER BY is_primary DESC, created_at`)));
settingsRoutes.post('/domains', requireRole('OWNER', 'ADMIN'), async (c) => {
  const body = await parseBody(c, z.object({ hostname: z.string().min(1), domain_type: z.enum(['WORKERS_DEV', 'SUBDOMAIN', 'CUSTOM']).default('CUSTOM'), zone_id: z.string().optional() }));
  const id = newId('dom');
  await run(c.env.DB, `INSERT INTO managed_domains (id, hostname, domain_type, status, zone_id) VALUES (?1,?2,?3,'PENDING',?4)`, id, body.hostname, body.domain_type, body.zone_id ?? null);
  await audit(c.env.DB, { entityType: 'domain', entityId: id, eventType: 'DOMAIN_ADDED', actorEmail: c.get('actor')!.email, metadata: { hostname: body.hostname } });
  return ok(c, { id }, 201);
});

// -------------------------- Email channels ------------------------------
settingsRoutes.get('/email-channels', async (c) => ok(c, await all(c.env.DB, `SELECT * FROM email_channels ORDER BY channel_type, created_at`)));
settingsRoutes.post('/email-channels', requireRole('OWNER', 'ADMIN'), async (c) => {
  const body = await parseBody(c, emailChannelSchema);
  const id = newId('ech');
  await run(
    c.env.DB,
    `INSERT INTO email_channels (id, channel_type, email_address, local_part, domain, provider, is_default, status, max_size_bytes)
     VALUES (?1,?2,?3,?4,?5,?6,?7,'DRAFT',?8)`,
    id, body.channel_type, body.email_address, body.local_part ?? null, body.domain ?? null,
    body.provider ?? null, body.is_default ? 1 : 0, body.max_size_bytes ?? null,
  );
  await audit(c.env.DB, { entityType: 'email_channel', entityId: id, eventType: body.channel_type === 'INBOUND' ? 'INBOUND_EMAIL_CONFIGURED' : 'OUTBOUND_EMAIL_CONFIGURED', actorEmail: c.get('actor')!.email });
  return ok(c, { id }, 201);
});

// ---------------------------- Cloudflare --------------------------------
settingsRoutes.get('/cloudflare', async (c) => ok(c, await getIntegration(c.env.DB)));
settingsRoutes.post('/cloudflare/test', requireRole('OWNER', 'ADMIN'), async (c) => {
  const body = await parseBody(c, z.object({ api_token: z.string().min(1) }));
  const verify = await cfApi.verifyToken(body.api_token);
  await audit(c.env.DB, { entityType: 'cloudflare', eventType: 'CLOUDFLARE_CONNECTION_TESTED', actorEmail: c.get('actor')!.email, metadata: { ok: verify.ok } });
  if (!verify.ok) throw new AppError('VALIDATION_ERROR', verify.message ?? 'token invalid');
  return ok(c, { ok: true, status: verify.status });
});
settingsRoutes.put('/cloudflare', requireRole('OWNER', 'ADMIN'), async (c) => {
  const body = await parseBody(c, z.object({ account_id: z.string().optional(), zone_id: z.string().optional(), zone_name: z.string().optional(), worker_script_name: z.string().optional(), primary_domain: z.string().optional() }));
  const updated = await upsertIntegration(c.env.DB, body);
  return ok(c, updated);
});

/** Generic group read (non-secret values only). */
settingsRoutes.get('/group/:group', async (c) => {
  const group = c.req.param('group').toUpperCase() as 'GENERAL';
  return ok(c, await getGroup(c.env.DB, group));
});

/** Generic group write — used e.g. by the national-currency / redenomination panel. */
const GROUPS = ['GENERAL', 'INVOICE', 'EMAIL_INBOUND', 'EMAIL_OUTBOUND', 'EINVOICE', 'SECURITY', 'CLOUDFLARE', 'ARCHIVE', 'LOCALIZATION'] as const;
settingsRoutes.put('/group/:group', requireRole('OWNER', 'ADMIN'), async (c) => {
  const raw = c.req.param('group').toUpperCase();
  if (!GROUPS.includes(raw as (typeof GROUPS)[number])) throw new AppError('VALIDATION_ERROR', 'unknown group');
  const group = raw as (typeof GROUPS)[number];
  const body = await parseBody(c, z.record(z.unknown()));
  const email = c.get('actor')!.email;
  for (const [key, value] of Object.entries(body)) {
    await setSetting(c.env.DB, group, key, value, { updatedBy: email });
  }
  await audit(c.env.DB, { entityType: 'settings', eventType: 'SETTING_UPDATED', actorEmail: email, metadata: { group, keys: Object.keys(body) } });
  return ok(c, await getGroup(c.env.DB, group));
});
