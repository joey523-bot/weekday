CREATE TABLE IF NOT EXISTS password_recovery (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 code_hash TEXT NOT NULL, code_encrypted TEXT NOT NULL, created_at INTEGER NOT NULL,
 issued_at INTEGER, expires_at INTEGER, consumed_at INTEGER, redemption TEXT,
 issued_by TEXT
);
CREATE TABLE IF NOT EXISTS recovery_limits (
 key TEXT PRIMARY KEY, bucket INTEGER NOT NULL, count INTEGER NOT NULL
);
