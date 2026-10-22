CREATE TABLE IF NOT EXISTS admin_passkeys(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,public_key TEXT NOT NULL,counter INTEGER NOT NULL,transports TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS admin_challenges(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,challenge TEXT NOT NULL,kind TEXT NOT NULL,expires_at INTEGER NOT NULL,session_id TEXT);
CREATE TABLE IF NOT EXISTS admin_emergency(user_id TEXT PRIMARY KEY,code_hash TEXT NOT NULL,created_at INTEGER NOT NULL,consumed_at INTEGER,redemption TEXT);
