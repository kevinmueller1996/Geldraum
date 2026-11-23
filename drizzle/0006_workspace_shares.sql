CREATE TABLE IF NOT EXISTS workspace_shares (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace TEXT NOT NULL CHECK (workspace IN ('private','business')),
  recipient_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('view','edit')),
  accepted_by TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  UNIQUE(owner_id, workspace, recipient_id)
);
CREATE INDEX IF NOT EXISTS workspace_shares_recipient ON workspace_shares(recipient_id);
CREATE TABLE IF NOT EXISTS workspace_invite_mail_limits (
  bucket TEXT PRIMARY KEY NOT NULL,
  day TEXT NOT NULL,
  sent INTEGER NOT NULL
);
