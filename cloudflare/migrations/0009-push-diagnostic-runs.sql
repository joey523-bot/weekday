-- No business reminder or subscription changes. Only explicitly seeded, expiring, single-use diagnostic jobs.
CREATE TABLE IF NOT EXISTS push_diagnostic_runs (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  reminder_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  attempted_at TEXT NOT NULL DEFAULT '',
  results TEXT NOT NULL DEFAULT ''
);
