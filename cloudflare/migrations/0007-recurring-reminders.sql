-- Additive migration. Apply only with separately approved production release.
CREATE TABLE IF NOT EXISTS recurring_reminder_deliveries (
  user_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  reminder_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, series_id, scheduled_date, installation_id)
);
CREATE INDEX IF NOT EXISTS idx_recurring_reminder_delivery_recent
  ON recurring_reminder_deliveries (user_id, attempted_at DESC);
