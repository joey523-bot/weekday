CREATE TABLE IF NOT EXISTS salary_push_subscriptions (
  installation_id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  salary_day INTEGER NOT NULL DEFAULT 15,
  lead_days INTEGER NOT NULL DEFAULT 0,
  reminder_hour INTEGER NOT NULL DEFAULT 9,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  enabled INTEGER NOT NULL DEFAULT 1,
  permission TEXT NOT NULL DEFAULT 'default',
  app_name TEXT NOT NULL DEFAULT '星期',
  user_id TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  last_sent_key TEXT NOT NULL DEFAULT '',
  last_sent_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_salary_push_enabled
  ON salary_push_subscriptions (enabled, reminder_hour);

CREATE INDEX IF NOT EXISTS idx_salary_push_user
  ON salary_push_subscriptions (user_id, installation_id);

CREATE TABLE IF NOT EXISTS reminder_push_rules (
  installation_id TEXT NOT NULL,
  reminder_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '其他',
  reminder_date TEXT NOT NULL,
  lead_days INTEGER NOT NULL DEFAULT 0,
  reminder_hour INTEGER NOT NULL DEFAULT 9,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_sent_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (installation_id, reminder_id)
);

CREATE INDEX IF NOT EXISTS idx_reminder_push_due
  ON reminder_push_rules (enabled, reminder_date, reminder_hour);

CREATE TABLE IF NOT EXISTS push_delivery_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id TEXT NOT NULL,
  reminder_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  cycle_key TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  attempted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_delivery_attempts_recent
  ON push_delivery_attempts (installation_id, attempted_at DESC);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions (expires_at);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  locked_until TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS account_sync (
  user_id TEXT PRIMARY KEY,
  snapshot_data TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS salary_daily_push_rules (
  installation_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  last_sent_key TEXT NOT NULL DEFAULT '',
  last_sent_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
