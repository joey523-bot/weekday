
CREATE TABLE IF NOT EXISTS cycle_suggestion_deliveries (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 installation_id TEXT NOT NULL,
 anchor_tokens TEXT NOT NULL,
 status TEXT NOT NULL,
 attempted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cycle_suggestion_owner ON cycle_suggestion_deliveries(user_id, installation_id);
CREATE TABLE IF NOT EXISTS cycle_suggestion_seen (
 user_id TEXT NOT NULL,
 installation_id TEXT NOT NULL,
 event_token TEXT NOT NULL,
 delivery_id TEXT NOT NULL,
 PRIMARY KEY(user_id, installation_id, event_token)
);
