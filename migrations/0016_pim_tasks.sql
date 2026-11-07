-- To-dos (ActiveSync "Tasks"), per user like calendar/contacts/notes.
CREATE TABLE IF NOT EXISTS pim_tasks (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  subject         TEXT NOT NULL DEFAULT '',
  body            TEXT,
  complete        INTEGER NOT NULL DEFAULT 0,
  completed_at    TEXT,                -- UTC ISO
  due_date        TEXT,                -- YYYY-MM-DD (the user's local date)
  due_utc         TEXT,                -- UTC ISO of that local midnight
  start_date      TEXT,
  start_utc       TEXT,
  importance      INTEGER NOT NULL DEFAULT 1, -- 0 low, 1 normal, 2 high
  reminder_at     TEXT,                -- UTC ISO, null = no reminder
  sensitivity     INTEGER NOT NULL DEFAULT 0,
  recurrence_json TEXT,                -- kept as sent by a phone
  categories_json TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pim_tasks_owner ON pim_tasks(owner_id, complete, due_date);
