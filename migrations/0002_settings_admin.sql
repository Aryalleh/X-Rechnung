-- =============================================================================
-- X-Rechnung — Settings / Admin / Cloudflare integration schema.
--
-- Everything the operator would otherwise hardcode (owner email, app name,
-- domains, tax texts, invoice prefixes, validator config, email addresses)
-- lives here and is edited from the admin panel. Secrets go to secret_store
-- (AES-GCM encrypted) and are never stored in plaintext.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- Single-row setup lifecycle state.
CREATE TABLE IF NOT EXISTS setup_state (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  state                 TEXT NOT NULL DEFAULT 'SETUP_REQUIRED'
                          CHECK (state IN ('SETUP_REQUIRED','IN_PROGRESS','ACTIVE','RECOVERY')),
  setup_token_hash      TEXT,          -- SHA-256 of the one-time setup token (raw never stored)
  setup_token_created_at TEXT,
  setup_token_used_at   TEXT,
  setup_attempts        INTEGER NOT NULL DEFAULT 0,
  completed_at          TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Grouped versioned settings. is_secret rows only store a reference; the
-- ciphertext lives in secret_store.
CREATE TABLE IF NOT EXISTS system_settings (
  id            TEXT PRIMARY KEY,
  setting_group TEXT NOT NULL
                  CHECK (setting_group IN ('GENERAL','SELLER','INVOICE','EMAIL_INBOUND',
                                           'EMAIL_OUTBOUND','EINVOICE','SECURITY','CLOUDFLARE',
                                           'ARCHIVE','LOCALIZATION')),
  setting_key   TEXT NOT NULL,
  value_json    TEXT,
  value_type    TEXT NOT NULL DEFAULT 'string',
  is_secret     INTEGER NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_group_key ON system_settings(setting_group, setting_key);

-- Admin users. Roles are modelled now; only OWNER is created at setup.
CREATE TABLE IF NOT EXISTS admin_users (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL UNIQUE,
  full_name          TEXT,
  recovery_email     TEXT,
  role               TEXT NOT NULL DEFAULT 'OWNER'
                       CHECK (role IN ('OWNER','ADMIN','ACCOUNTANT','READ_ONLY')),
  status             TEXT NOT NULL DEFAULT 'ACTIVE'
                       CHECK (status IN ('ACTIVE','DISABLED')),
  access_identity_id TEXT,
  access_synced_at   TEXT,
  last_login_at      TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_role   ON admin_users(role);
CREATE INDEX IF NOT EXISTS idx_admin_status ON admin_users(status);

-- Server-side admin sessions (for CSRF token binding + last-seen).
CREATE TABLE IF NOT EXISTS admin_sessions (
  id            TEXT PRIMARY KEY,
  admin_user_id TEXT REFERENCES admin_users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  csrf_token    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at    TEXT NOT NULL,
  last_seen_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_email ON admin_sessions(email);

-- Cloudflare integration state (discovered / synced resources).
CREATE TABLE IF NOT EXISTS cloudflare_integrations (
  id                     TEXT PRIMARY KEY,
  account_id             TEXT,
  zone_id                TEXT,
  zone_name              TEXT,
  worker_script_name     TEXT,
  access_application_id  TEXT,
  access_policy_id       TEXT,
  access_aud             TEXT,
  access_team_domain     TEXT,
  primary_domain         TEXT,
  email_routing_enabled  INTEGER NOT NULL DEFAULT 0,
  connection_status      TEXT NOT NULL DEFAULT 'NOT_CONFIGURED'
                           CHECK (connection_status IN ('NOT_CONFIGURED','OK','WARNING','ERROR','TESTING')),
  last_tested_at         TEXT,
  last_synced_at         TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS cloudflare_sync_jobs (
  id            TEXT PRIMARY KEY,
  job_type      TEXT NOT NULL,   -- SYNC_ACCESS | SYNC_DOMAIN | SYNC_EMAIL_ROUTING | HEALTH_CHECK
  status        TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','ROLLED_BACK')),
  desired_json  TEXT,
  actual_json   TEXT,
  error_text    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at   TEXT
);

CREATE TABLE IF NOT EXISTS managed_domains (
  id                    TEXT PRIMARY KEY,
  hostname              TEXT NOT NULL UNIQUE,
  domain_type           TEXT NOT NULL DEFAULT 'CUSTOM'
                          CHECK (domain_type IN ('WORKERS_DEV','SUBDOMAIN','CUSTOM')),
  is_primary            INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','VERIFYING','ACTIVE','FAILED','DISABLED','REMOVAL_PENDING')),
  zone_id               TEXT,
  tls_status            TEXT,
  dns_status            TEXT,
  access_status         TEXT,
  email_routing_status  TEXT,
  cloudflare_resource_id TEXT,
  verified_at           TEXT,
  last_checked_at       TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_domains_primary ON managed_domains(is_primary);

CREATE TABLE IF NOT EXISTS email_channels (
  id              TEXT PRIMARY KEY,
  channel_type    TEXT NOT NULL CHECK (channel_type IN ('INBOUND','OUTBOUND')),
  email_address   TEXT NOT NULL,
  local_part      TEXT,
  domain          TEXT,
  provider        TEXT,   -- CLOUDFLARE_EMAIL_SERVICE | EXTERNAL_EMAIL_PROVIDER | DISABLED | EMAIL_ROUTING
  is_default      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','ROUTE_CREATED','AWAITING_TEST','ACTIVE','FAILED','DISABLED',
                                      'UNCONFIGURED','PENDING_VERIFICATION')),
  routing_rule_id TEXT,
  max_size_bytes  INTEGER,
  last_tested_at  TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_email_channel_type ON email_channels(channel_type);

-- Versioned configuration change history (hashes only for sensitive values).
CREATE TABLE IF NOT EXISTS configuration_versions (
  id                    TEXT PRIMARY KEY,
  version_code          TEXT NOT NULL UNIQUE,   -- CONFIG-2026-000001
  target                TEXT NOT NULL,          -- what changed (owner_email, access_policy, ...)
  previous_value_hash   TEXT,
  new_value_hash        TEXT,
  changed_by            TEXT,
  reason                TEXT,
  cloudflare_sync_status TEXT,
  rollback_available    INTEGER NOT NULL DEFAULT 0,
  snapshot_json         TEXT,   -- non-sensitive snapshot for rollback
  changed_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS configuration_audit_events (
  id            TEXT PRIMARY KEY,
  event_type    TEXT NOT NULL,
  actor_email   TEXT,
  target        TEXT,
  metadata_json TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_config_audit_type ON configuration_audit_events(event_type);

-- Encrypted secret storage (AES-GCM). Raw secret never persisted.
CREATE TABLE IF NOT EXISTS secret_store (
  id                 TEXT PRIMARY KEY,
  secret_name        TEXT NOT NULL UNIQUE,
  ciphertext         TEXT NOT NULL,   -- base64
  iv                 TEXT NOT NULL,   -- base64, unique per secret
  encryption_version INTEGER NOT NULL DEFAULT 1,
  last_four          TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  rotated_at         TEXT,
  last_used_at       TEXT
);
