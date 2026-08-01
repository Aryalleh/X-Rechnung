import { one, all, run } from '../client';
import { newId } from '../../lib/ids';

export type SettingGroup =
  | 'GENERAL' | 'SELLER' | 'INVOICE' | 'EMAIL_INBOUND' | 'EMAIL_OUTBOUND'
  | 'EINVOICE' | 'SECURITY' | 'CLOUDFLARE' | 'ARCHIVE' | 'LOCALIZATION';

export interface SettingRow {
  id: string;
  setting_group: SettingGroup;
  setting_key: string;
  value_json: string | null;
  value_type: string;
  is_secret: number;
  version: number;
  updated_by: string | null;
  updated_at: string;
}

export async function getSetting<T>(db: D1Database, group: SettingGroup, key: string): Promise<T | undefined> {
  const row = await one<SettingRow>(
    db,
    `SELECT * FROM system_settings WHERE setting_group = ?1 AND setting_key = ?2`,
    group,
    key,
  );
  if (!row || row.value_json === null) return undefined;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return undefined;
  }
}

export async function getGroup(db: D1Database, group: SettingGroup): Promise<Record<string, unknown>> {
  const rows = await all<SettingRow>(
    db,
    `SELECT * FROM system_settings WHERE setting_group = ?1 AND is_secret = 0`,
    group,
  );
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    if (r.value_json === null) continue;
    try {
      out[r.setting_key] = JSON.parse(r.value_json);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

export async function setSetting(
  db: D1Database,
  group: SettingGroup,
  key: string,
  value: unknown,
  opts: { isSecret?: boolean; updatedBy?: string } = {},
): Promise<void> {
  const existing = await one<SettingRow>(
    db,
    `SELECT id, version FROM system_settings WHERE setting_group = ?1 AND setting_key = ?2`,
    group,
    key,
  );
  const valueJson = opts.isSecret ? null : JSON.stringify(value);
  const valueType = typeof value;
  if (existing) {
    await run(
      db,
      `UPDATE system_settings
         SET value_json = ?3, value_type = ?4, is_secret = ?5, version = version + 1,
             updated_by = ?6, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?1 AND setting_group = ?2`,
      existing.id,
      group,
      valueJson,
      valueType,
      opts.isSecret ? 1 : 0,
      opts.updatedBy ?? null,
    );
  } else {
    await run(
      db,
      `INSERT INTO system_settings (id, setting_group, setting_key, value_json, value_type, is_secret, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      newId('set'),
      group,
      key,
      valueJson,
      valueType,
      opts.isSecret ? 1 : 0,
      opts.updatedBy ?? null,
    );
  }
}
