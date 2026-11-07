-- Personal calendar, contacts and notes (per user; synced to phones over ActiveSync).
CREATE TABLE IF NOT EXISTS pim_events (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  uid             TEXT,
  subject         TEXT NOT NULL DEFAULT '',
  location        TEXT,
  body            TEXT,
  start_at        TEXT NOT NULL,          -- UTC ISO
  end_at          TEXT NOT NULL,          -- UTC ISO
  all_day         INTEGER NOT NULL DEFAULT 0,
  tz_blob         TEXT,                   -- ActiveSync TIME_ZONE_INFORMATION (base64) as sent by a phone
  reminder_min    INTEGER,
  busy_status     INTEGER NOT NULL DEFAULT 2,
  sensitivity     INTEGER NOT NULL DEFAULT 0,
  recurrence_json TEXT,
  attendees_json  TEXT,
  organizer_name  TEXT,
  organizer_email TEXT,
  categories_json TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pim_events_owner ON pim_events(owner_id, start_at);

CREATE TABLE IF NOT EXISTS pim_contacts (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  display_name    TEXT NOT NULL DEFAULT '',
  email           TEXT,
  phone           TEXT,
  company         TEXT,
  data_json       TEXT NOT NULL DEFAULT '{}', -- ActiveSync contact fields (FirstName, Email1Address, …)
  body            TEXT,
  categories_json TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pim_contacts_owner ON pim_contacts(owner_id, display_name);

CREATE TABLE IF NOT EXISTS pim_notes (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  subject         TEXT NOT NULL DEFAULT '',
  body            TEXT NOT NULL DEFAULT '',
  categories_json TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pim_notes_owner ON pim_notes(owner_id, updated_at);
