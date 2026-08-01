import { one, all, run } from '../client';
import { newId } from '../../lib/ids';

export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  recovery_email: string | null;
  role: 'OWNER' | 'ADMIN' | 'ACCOUNTANT' | 'READ_ONLY';
  status: 'ACTIVE' | 'DISABLED';
  access_identity_id: string | null;
  access_synced_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export function findAdminByEmail(db: D1Database, email: string): Promise<AdminUser | null> {
  return one<AdminUser>(db, `SELECT * FROM admin_users WHERE lower(email) = lower(?1)`, email);
}

export function listAdmins(db: D1Database): Promise<AdminUser[]> {
  return all<AdminUser>(db, `SELECT * FROM admin_users ORDER BY created_at ASC`);
}

export async function createAdmin(
  db: D1Database,
  input: { email: string; full_name?: string; recovery_email?: string; role: AdminUser['role'] },
): Promise<AdminUser> {
  const id = newId('adm');
  await run(
    db,
    `INSERT INTO admin_users (id, email, full_name, recovery_email, role, status)
     VALUES (?1, ?2, ?3, ?4, ?5, 'ACTIVE')`,
    id,
    input.email.toLowerCase(),
    input.full_name ?? null,
    input.recovery_email ?? null,
    input.role,
  );
  return (await one<AdminUser>(db, `SELECT * FROM admin_users WHERE id = ?1`, id))!;
}

export async function countActiveOwners(db: D1Database): Promise<number> {
  const row = await one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM admin_users WHERE role = 'OWNER' AND status = 'ACTIVE'`,
  );
  return row?.n ?? 0;
}

export async function updateAdminRole(db: D1Database, id: string, role: AdminUser['role']): Promise<void> {
  await run(db, `UPDATE admin_users SET role = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`, id, role);
}

export async function setAdminStatus(db: D1Database, id: string, status: AdminUser['status']): Promise<void> {
  await run(db, `UPDATE admin_users SET status = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`, id, status);
}

export async function recordLogin(db: D1Database, email: string): Promise<void> {
  await run(
    db,
    `UPDATE admin_users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE lower(email) = lower(?1)`,
    email,
  );
}
