-- Personal mailboxes: each user may own one address on the mail domain.
-- mail_only = 1 → "email user": can only use the mailbox (no invoicing). Kept as a flag
-- instead of a new role so admin_users (and its sessions) need no table rebuild.
ALTER TABLE admin_users ADD COLUMN mail_address TEXT;
ALTER TABLE admin_users ADD COLUMN mail_only INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_mail_address ON admin_users(lower(mail_address)) WHERE mail_address IS NOT NULL;
