-- Exchange ActiveSync: phones/mail apps sync the mailbox over HTTPS.
CREATE TABLE IF NOT EXISTS eas_devices (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  device_id     TEXT NOT NULL,
  device_type   TEXT,
  user_agent    TEXT,
  model         TEXT,
  friendly_name TEXT,
  os            TEXT,
  protocol      TEXT,
  policy_key    TEXT,
  blocked       INTEGER NOT NULL DEFAULT 0,
  sync_cache    TEXT,             -- last full Sync request (clients may send empty/partial ones)
  ping_cache    TEXT,             -- last Ping folder list + heartbeat
  first_seen    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, device_id)
);

-- Per device + folder: the sync key and what the device currently has (id → read/flag state).
CREATE TABLE IF NOT EXISTS eas_sync_state (
  device_pk     TEXT NOT NULL REFERENCES eas_devices(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL,
  sync_key      TEXT NOT NULL,
  snapshot      TEXT NOT NULL DEFAULT '{}',
  prev_key      TEXT,
  prev_snapshot TEXT,
  options       TEXT,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (device_pk, collection_id)
);
