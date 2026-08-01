/** System status + public bootstrap endpoint. */
import { Hono } from 'hono';
import type { HonoEnv } from '../http-types';
import { ok } from '../lib/response';
import { getSetupRow } from '../services/setup-service';
import { getIntegration } from '../db/repositories/cloudflare-repo';
import { getActiveSeller } from '../db/repositories/seller-repo';
import { getGeneralSettings, getEInvoiceSettings } from '../services/settings-service';
import { secretStorageEnabled } from '../services/secret-service';
import { all } from '../db/client';
import { listAudit } from '../services/audit-service';

export const systemRoutes = new Hono<HonoEnv>();

/** Public: minimal info the SPA needs before auth to decide setup vs app. */
systemRoutes.get('/bootstrap', async (c) => {
  const setup = await getSetupRow(c.env.DB);
  const general = await getGeneralSettings(c.env.DB);
  return ok(c, {
    setupState: c.get('setupState'),
    appName: general.app_name,
    locale: general.locale,
    timezone: general.timezone,
    invoiceLanguage: general.invoice_language,
    theme: general.theme,
    hasOwner: Boolean(setup?.state === 'ACTIVE'),
  });
});

/** Authenticated: full system status board. */
systemRoutes.get('/status', async (c) => {
  const cf = await getIntegration(c.env.DB);
  const seller = await getActiveSeller(c.env.DB);
  const einvoice = await getEInvoiceSettings(c.env.DB);
  const failedJobs = await all<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM job_failures WHERE resolved=0`);
  const invalid = await all<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM received_invoices WHERE validation_status IN ('BASIC_INVALID','STRICT_INVALID','PROCESSING_ERROR')`);

  const items: Record<string, string> = {
    D1: 'OK',
    R2: 'OK',
    DurableObject: 'OK',
    Queue: 'OK',
    BrowserRun: 'OK',
    CloudflareAccess: cf?.access_aud ? 'OK' : c.env.ENVIRONMENT === 'production' ? 'NOT_CONFIGURED' : 'WARNING',
    CustomDomain: cf?.primary_domain ? 'OK' : 'NOT_CONFIGURED',
    InboundEmail: cf?.email_routing_enabled ? 'OK' : 'NOT_CONFIGURED',
    OutboundEmail: 'NOT_CONFIGURED',
    EInvoiceParser: 'OK',
    KoSITValidator: einvoice.kosit_url ? 'OK' : 'NOT_CONFIGURED',
    ArchiveLock: 'WARNING', // must be verified out-of-band; never assume
    SecretStore: secretStorageEnabled(c.env) ? 'OK' : 'NOT_CONFIGURED',
    SellerProfile: seller ? 'OK' : 'NOT_CONFIGURED',
  };

  return ok(c, {
    items,
    failedJobs: failedJobs[0]?.n ?? 0,
    invalidEInvoices: invalid[0]?.n ?? 0,
  });
});

systemRoutes.get('/audit', async (c) => {
  const limit = Number(c.req.query('limit') ?? '200');
  return ok(c, await listAudit(c.env.DB, Math.min(limit, 1000)));
});
