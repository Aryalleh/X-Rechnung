/**
 * Setup wizard API. Guarded by the setup gate (only reachable while state is
 * SETUP_REQUIRED / IN_PROGRESS) and a rate limit. No setup secret: the first
 * person to submit the owner form becomes OWNER and receives an HttpOnly
 * setup-claim cookie that the remaining steps require. Nothing is hardcoded — the owner, domain, Access app and email
 * routing are all created here from operator input.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { HonoEnv } from '../http-types';
import { z } from 'zod';
import { ok } from '../lib/response';
import { AppError } from '../lib/errors';
import { parseBody } from '../lib/validate-request';
import { rateLimit } from '../middleware/rate-limit';
import { setupStep1Schema } from '../lib/schemas';
import { claimSetup, verifySetupClaim, completeSetup, getSetupRow } from '../services/setup-service';
import { createAdmin, countActiveOwners, findAdminByEmail } from '../db/repositories/admin-repo';
import { setSetting } from '../db/repositories/settings-repo';
import { upsertIntegration } from '../db/repositories/cloudflare-repo';
import { audit } from '../services/audit-service';
import * as cfApi from '../services/cloudflare-api-service';

export const setupRoutes = new Hono<HonoEnv>();

setupRoutes.use('*', rateLimit({ key: 'setup', limit: 20, windowMs: 60_000 }));

const CLAIM_COOKIE = 'xr_setup_claim';

async function requireClaim(c: Context<HonoEnv>): Promise<void> {
  if (!(await verifySetupClaim(c.env.DB, getCookie(c, CLAIM_COOKIE)))) {
    throw new AppError('FORBIDDEN', 'setup was started from another browser');
  }
}

/**
 * Step 1: owner account + localization. The first caller claims setup and
 * becomes OWNER; the same browser may resubmit (e.g. to fix a typo).
 */
setupRoutes.post('/owner', async (c) => {
  const body = await parseBody(c, setupStep1Schema);
  // Validate everything BEFORE claiming, so a rejected form never locks setup.
  if (body.recovery_email && body.recovery_email.toLowerCase() === body.owner_email.toLowerCase()) {
    throw new AppError('VALIDATION_ERROR', 'recovery email must differ from owner email', {
      recovery_email: 'ایمیل بازیابی باید با ایمیل مالک متفاوت باشد (یا خالی بگذارید).',
    });
  }
  const alreadyMine = await verifySetupClaim(c.env.DB, getCookie(c, CLAIM_COOKIE));
  if (!alreadyMine) {
    if ((await countActiveOwners(c.env.DB)) > 0) throw new AppError('CONFLICT', 'owner already exists');
    const claim = await claimSetup(c.env.DB);
    if (!claim) throw new AppError('CONFLICT', 'setup already claimed by another user');
    setCookie(c, CLAIM_COOKIE, claim, {
      httpOnly: true,
      secure: new URL(c.req.url).protocol === 'https:',
      sameSite: 'Strict',
      path: '/api/setup',
      maxAge: 60 * 60 * 24,
    });
  }
  const existingOwner = alreadyMine ? await findAdminByEmail(c.env.DB, body.owner_email) : null;
  if (alreadyMine && !existingOwner && (await countActiveOwners(c.env.DB)) > 0) {
    throw new AppError('CONFLICT', 'owner already created; use the same email');
  }
  const owner = existingOwner ?? await createAdmin(c.env.DB, {
    email: body.owner_email,
    full_name: body.owner_name,
    ...(body.recovery_email ? { recovery_email: body.recovery_email } : {}),
    role: 'OWNER',
  });
  await setSetting(c.env.DB, 'LOCALIZATION', 'locale', body.locale, { updatedBy: body.owner_email });
  await setSetting(c.env.DB, 'LOCALIZATION', 'timezone', body.timezone, { updatedBy: body.owner_email });
  await setSetting(c.env.DB, 'GENERAL', 'owner_email', body.owner_email, { updatedBy: body.owner_email });

  // Installation profile → default currency + invoice language.
  await setSetting(c.env.DB, 'LOCALIZATION', 'invoice_mode', body.invoice_mode, { updatedBy: body.owner_email });
  if (body.invoice_mode === 'fa') {
    await setSetting(c.env.DB, 'LOCALIZATION', 'invoice_language', 'fa', { updatedBy: body.owner_email });
    await setSetting(c.env.DB, 'LOCALIZATION', 'currency', 'IRT', { updatedBy: body.owner_email });
    await setSetting(c.env.DB, 'LOCALIZATION', 'country', 'IR', { updatedBy: body.owner_email });
  } else if (body.invoice_mode === 'de') {
    await setSetting(c.env.DB, 'LOCALIZATION', 'invoice_language', 'de', { updatedBy: body.owner_email });
    await setSetting(c.env.DB, 'LOCALIZATION', 'currency', 'EUR', { updatedBy: body.owner_email });
    await setSetting(c.env.DB, 'LOCALIZATION', 'country', 'DE', { updatedBy: body.owner_email });
  }
  await audit(c.env.DB, { entityType: 'admin_user', entityId: owner.id, eventType: 'OWNER_CREATED', actorEmail: body.owner_email });
  return ok(c, { ownerId: owner.id, email: owner.email });
});

/** Step 2: connect Cloudflare + create Access application/policy + custom domain. */
const cfSchema = z.object({
  account_id: z.string().min(1),
  zone_id: z.string().min(1),
  zone_name: z.string().min(1),
  worker_script_name: z.string().min(1),
  api_token: z.string().min(1),
  owner_email: z.string().email(),
  app_domain: z.string().min(1), // hostname to bind + protect
});

setupRoutes.post('/cloudflare', async (c) => {
  await requireClaim(c);
  const body = await parseBody(c, cfSchema);

  // The token is used only within this request and never persisted here.
  const verify = await cfApi.verifyToken(body.api_token);
  if (!verify.ok) throw new AppError('VALIDATION_ERROR', `Cloudflare token invalid: ${verify.message}`);

  // Bind the custom domain to the Worker (safe-change: new domain first).
  await cfApi.addWorkerCustomDomain(body.api_token, body.account_id, body.app_domain, body.worker_script_name, body.zone_id);

  // Create Access application + owner-only policy.
  const appName = 'X-Rechnung';
  const { appId, aud } = await cfApi.createAccessApp(body.api_token, { accountId: body.account_id, name: appName, domain: body.app_domain });
  const { policyId } = await cfApi.createOwnerPolicy(body.api_token, body.account_id, appId, body.owner_email);
  const teamDomain = await cfApi.getAccessTeamDomain(body.api_token, body.account_id);

  await upsertIntegration(c.env.DB, {
    account_id: body.account_id,
    zone_id: body.zone_id,
    zone_name: body.zone_name,
    worker_script_name: body.worker_script_name,
    access_application_id: appId,
    access_policy_id: policyId,
    access_aud: aud,
    access_team_domain: teamDomain,
    primary_domain: body.app_domain,
    connection_status: 'OK',
    last_synced_at: new Date().toISOString(),
  });
  await setSetting(c.env.DB, 'GENERAL', 'base_url', `https://${body.app_domain}`, { updatedBy: body.owner_email });
  await audit(c.env.DB, { entityType: 'cloudflare', eventType: 'ACCESS_APPLICATION_CREATED', actorEmail: body.owner_email, metadata: { appId, domain: body.app_domain } });

  return ok(c, { appId, aud, teamDomain, domain: body.app_domain, loginUrl: `https://${body.app_domain}/` });
});

/** Step 3: finalize. Requires an active owner to exist. */
setupRoutes.post('/complete', async (c) => {
  await requireClaim(c);
  const body = await parseBody(c, z.object({ owner_email: z.string().email() }));
  const owners = await countActiveOwners(c.env.DB);
  if (owners < 1) throw new AppError('CONFLICT', 'no owner configured');
  await completeSetup(c.env, body.owner_email);
  deleteCookie(c, CLAIM_COOKIE, { path: '/api/setup' });
  return ok(c, { state: 'ACTIVE' });
});

/** Setup status for the wizard UI. */
setupRoutes.get('/state', async (c) => {
  const row = await getSetupRow(c.env.DB);
  return ok(c, { state: row?.state ?? 'SETUP_REQUIRED' });
});
