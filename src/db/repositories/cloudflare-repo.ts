import { one, run } from '../client';
import { newId } from '../../lib/ids';

export interface CloudflareIntegration {
  id: string;
  account_id: string | null;
  zone_id: string | null;
  zone_name: string | null;
  worker_script_name: string | null;
  access_application_id: string | null;
  access_policy_id: string | null;
  access_aud: string | null;
  access_team_domain: string | null;
  primary_domain: string | null;
  email_routing_enabled: number;
  connection_status: string;
  last_tested_at: string | null;
  last_synced_at: string | null;
}

export async function getIntegration(db: D1Database): Promise<CloudflareIntegration | null> {
  return one<CloudflareIntegration>(db, `SELECT * FROM cloudflare_integrations LIMIT 1`);
}

export async function upsertIntegration(
  db: D1Database,
  patch: Partial<Omit<CloudflareIntegration, 'id'>>,
): Promise<CloudflareIntegration> {
  const existing = await getIntegration(db);
  if (!existing) {
    const id = newId('cfi');
    await run(
      db,
      `INSERT INTO cloudflare_integrations
         (id, account_id, zone_id, zone_name, worker_script_name, access_application_id,
          access_policy_id, access_aud, access_team_domain, primary_domain,
          email_routing_enabled, connection_status)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
      id,
      patch.account_id ?? null,
      patch.zone_id ?? null,
      patch.zone_name ?? null,
      patch.worker_script_name ?? null,
      patch.access_application_id ?? null,
      patch.access_policy_id ?? null,
      patch.access_aud ?? null,
      patch.access_team_domain ?? null,
      patch.primary_domain ?? null,
      patch.email_routing_enabled ?? 0,
      patch.connection_status ?? 'NOT_CONFIGURED',
    );
    return (await getIntegration(db))!;
  }
  const merged = { ...existing, ...patch };
  await run(
    db,
    `UPDATE cloudflare_integrations SET
       account_id=?2, zone_id=?3, zone_name=?4, worker_script_name=?5,
       access_application_id=?6, access_policy_id=?7, access_aud=?8, access_team_domain=?9,
       primary_domain=?10, email_routing_enabled=?11, connection_status=?12,
       last_tested_at=?13, last_synced_at=?14,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id=?1`,
    existing.id,
    merged.account_id,
    merged.zone_id,
    merged.zone_name,
    merged.worker_script_name,
    merged.access_application_id,
    merged.access_policy_id,
    merged.access_aud,
    merged.access_team_domain,
    merged.primary_domain,
    merged.email_routing_enabled,
    merged.connection_status,
    merged.last_tested_at,
    merged.last_synced_at,
  );
  return (await getIntegration(db))!;
}
