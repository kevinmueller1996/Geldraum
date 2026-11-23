CREATE TABLE IF NOT EXISTS dashboard_preferences (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  basis TEXT NOT NULL CHECK (basis IN ('gross', 'net'))
);
