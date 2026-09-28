CREATE TABLE IF NOT EXISTS salary_daily_push_rules (
  installation_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  last_sent_key TEXT NOT NULL DEFAULT '',
  last_sent_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
