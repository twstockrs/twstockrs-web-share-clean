export const authSchemaSQL=`
CREATE TABLE accounts (account_id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','admin')), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), grant_plan TEXT NOT NULL CHECK(grant_plan IN ('Free','Pro')), pro_until INTEGER, revision INTEGER NOT NULL CHECK(revision>=1), created_at INTEGER NOT NULL);
CREATE TABLE auth_sessions (token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, account_id TEXT REFERENCES accounts(account_id), created_at INTEGER NOT NULL, idle_until INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE auth_attempts (key TEXT PRIMARY KEY, failures INTEGER NOT NULL, until_at INTEGER NOT NULL);
CREATE TABLE auth_events (event_id INTEGER PRIMARY KEY, at INTEGER NOT NULL, account_id TEXT, event TEXT NOT NULL);
CREATE TABLE auth_config (id INTEGER PRIMARY KEY CHECK(id=1), instance TEXT NOT NULL);
CREATE TABLE share_owners (token TEXT PRIMARY KEY REFERENCES frozen_shares(token) ON DELETE CASCADE, owner TEXT NOT NULL REFERENCES workspace(owner));
`;
