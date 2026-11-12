-- Which folder-hierarchy version each phone has (FolderSync key), so the server can tell
-- phones set up before calendar/contacts/notes/tasks existed to re-read the folder list.
ALTER TABLE eas_devices ADD COLUMN hierarchy_key TEXT;
-- When the phone was last told "folder list changed" (Ping 7 / Sync 12); throttles the hint.
ALTER TABLE eas_devices ADD COLUMN hierarchy_hint_at TEXT;
