CREATE TABLE IF NOT EXISTS clockout_deliveries (
 user_id TEXT NOT NULL,
 installation_id TEXT NOT NULL,
 day TEXT NOT NULL,
 status TEXT NOT NULL,
 attempted_at TEXT NOT NULL,
 PRIMARY KEY(user_id, installation_id, day)
);
