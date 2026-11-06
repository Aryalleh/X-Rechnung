-- Built-in mailbox: every email received by the Worker (Cloudflare Email Routing)
-- and every email sent through the send_email binding.
CREATE TABLE IF NOT EXISTS mail_messages (
  id                TEXT PRIMARY KEY,
  folder            TEXT NOT NULL DEFAULT 'INBOX' CHECK (folder IN ('INBOX','SENT','ARCHIVE','TRASH')),
  direction         TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  mailbox           TEXT,            -- our address: envelope "to" (IN) or "from" (OUT)
  message_id        TEXT,
  in_reply_to       TEXT,
  thread_id         TEXT NOT NULL,
  from_email        TEXT,
  from_name         TEXT,
  to_email          TEXT,
  cc_email          TEXT,
  subject           TEXT,
  snippet           TEXT,
  text_body         TEXT,
  html_body         TEXT,
  has_attachments   INTEGER NOT NULL DEFAULT 0,
  size_bytes        INTEGER NOT NULL DEFAULT 0,
  raw_r2_key        TEXT,
  is_read           INTEGER NOT NULL DEFAULT 0,
  is_starred        INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','SENT','FAILED')),
  error_text        TEXT,
  received_email_id TEXT,
  related_type      TEXT,            -- e.g. received_invoice / invoice / contract
  related_id        TEXT,
  sent_by           TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_mail_folder ON mail_messages(folder, created_at);
CREATE INDEX IF NOT EXISTS idx_mail_thread ON mail_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_mail_msgid ON mail_messages(message_id);

CREATE TABLE IF NOT EXISTS mail_attachments (
  id          TEXT PRIMARY KEY,
  mail_id     TEXT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  content_id  TEXT,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  sha256      TEXT,
  r2_key      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_mail_att_mail ON mail_attachments(mail_id);
