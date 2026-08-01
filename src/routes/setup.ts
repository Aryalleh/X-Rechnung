/**
 * Setup wizard API. Guarded by the setup gate (only reachable while state is
 * SETUP_REQUIRED / IN_PROGRESS) and by a hard rate limit + persistent attempts
 * counter. Nothing is hardcoded — the owner, domain, Access app and email
 * routing are all created here from operator input.
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../http-types';
import { z } from 'zod';
import { ok } from '../lib/response';
import { AppError } from '../lib/errors';
import { parseBody } from '../lib/validate-request';
import { rateLimit } from '../middleware/rate-limit';
import { setupStep1Schema } from '../lib/schemas';
import { verifySetupToken, markInProgress, completeSetup, getSetupRow } from '../services/setup-service';
import { createAdmin, countActiveOwners } from '../db/repositories/admin-repo';
import { setSetting } from '../db/repositories/settings-repo';
import { upsertIntegration } from '../db/repositories/cloudflare-repo';
import { audit } from '../services/audit-service';
import * as cfApi from '../services/cloudflare-api-service';

export const setupRoutes = new Hono<HonoEnv>();

setupRoutes.use('*', rateLimit({ key: 'setup', limit: 20, windowMs: 60_000 }));

/** Step 0: verify the one-time setup token. */
setupRoutes.post('/verify-token', async (c) => {
  const { setup_token } = await parseBody(c, z.object({ setup_token: z.string().min(1) }));
  const valid = await verifySetupToken(c.env.DB, setup_token);
  if (!valid) throw new AppError('UNAUTHORIZED', 'invalid setup token');
  await markInProgress(c.env.DB);
  return ok(c, { verified: true });
});

/** Step 1: owner account + localization. Requires a valid token again. */
setupRoutes.post('/owner', async (c) => {
  const body = await parseBody(c, setupStep1Schema);
  if (!(await verifySetupToken(c.env.DB, body.setup_token))) throw new AppError('UNAUTHORIZED', 'invalid setup token');
  if (body.recovery_email && body.recovery_email === body.owner_email) {
    // allowed only with explicit confirm flag (kept simple: reject here)
    throw new AppError('VALIDATION_ERROR', 'recovery email must differ from owner email', { recovery_email: 'ایمیل بازیابی باید متفاوت باشد' });
  }
  const owner = await createAdmin(c.env.DB, {
    email: body.owner_email,
    full_name: body.owner_name,
    ...(body.recovery_email ? { recovery_email: body.recovery_email } : {}),
    role: 'OWNER',
  });
  await setSetting(c.env.DB, 'LOCALIZATION', 'locale', body.locale, { updatedBy: body.owner_email });
  await setSetting(c.env.DB, 'LOCALIZATION', 'timezone', body.timezone, { updatedBy: body.owner_email });
  await setSetting(c.env.DB, 'GENERAL', 'owner_email', body.owner_email, { updatedBy: body.owner_email });
  await audit(c.env.DB, { entityType: 'admin_user', entityId: owner.id, eventType: 'OWNER_CREATED', actorEmail: body.owner_email });
  return ok(c, { ownerId: owner.id, email: owner.email });
});

/** Step 2: connect Cloudflare + create Access application/policy + custom domain. */
const cfSchema = z.object({
  setup_token: z.string().min(1),
  account_id: z.string().min(1),
  zone_id: z.string().min(1),
  zone_name: z.string().min(1),
  worker_script_name: z.string().min(1),
  api_token: z.string().min(1),
  owner_email: z.string().email(),
  app_domain: z.string().min(1), // hostname to bind + protect
});

setupRoutes.post('/cloudflare', async (c) => {
  const body = await parseBody(c, cfSchema);
  if (!(await verifySetupToken(c.env.DB, body.setup_token))) throw new AppError('UNAUTHORIZED', 'invalid setup token');

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
  const body = await parseBody(c, z.object({ setup_token: z.string().min(1), owner_email: z.string().email() }));
  if (!(await verifySetupToken(c.env.DB, body.setup_token))) throw new AppError('UNAUTHORIZED', 'invalid setup token');
  const owners = await countActiveOwners(c.env.DB);
  if (owners < 1) throw new AppError('CONFLICT', 'no owner configured');
  await completeSetup(c.env, body.owner_email);
  return ok(c, { state: 'ACTIVE' });
});

/** Setup status for the wizard UI. */
setupRoutes.get('/state', async (c) => {
  const row = await getSetupRow(c.env.DB);
  return ok(c, { state: row?.state ?? 'SETUP_REQUIRED' });
});
