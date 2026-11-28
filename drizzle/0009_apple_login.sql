CREATE TABLE IF NOT EXISTS auth_apple_identities (
  subject TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  authorized_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_email_aliases (
  email_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL,
  verified_at TEXT NOT NULL
);
