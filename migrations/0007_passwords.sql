-- Password login for admin users (works with or without Cloudflare Access).
--   password_hash: "pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>"
--   failed_logins / locked_until: persistent brute-force lockout per account.
ALTER TABLE admin_users ADD COLUMN password_hash TEXT;
ALTER TABLE admin_users ADD COLUMN password_changed_at TEXT;
ALTER TABLE admin_users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admin_users ADD COLUMN locked_until TEXT;

-- admin_sessions (from 0002) stores sessions; id = SHA-256 of the cookie token,
-- so a leaked DB row cannot be replayed as a cookie.
CREATE INDEX IF NOT EXISTS idx_sessions_user ON admin_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON admin_sessions(expires_at);
