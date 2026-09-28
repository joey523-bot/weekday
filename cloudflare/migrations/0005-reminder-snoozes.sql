-- Additive, local candidate only. Apply before Pages/Worker release.
CREATE TABLE IF NOT EXISTS reminder_snoozes (
  user_id TEXT NOT NULL,
  reminder_id TEXT NOT NULL,
  token TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('once', 'hourly')),
  next_at TEXT NOT NULL,
  until_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, reminder_id)
);
CREATE TABLE IF NOT EXISTS reminder_snooze_deliveries (
  token TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  occurrence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'claimed',
  attempted_at TEXT NOT NULL,
  PRIMARY KEY(token, installation_id, occurrence)
);
CREATE INDEX IF NOT EXISTS idx_snooze_active ON reminder_snoozes(active, next_at);
