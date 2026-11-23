import { env } from "cloudflare:workers";

const USER_TABLE_SQL = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

const PLAN_TABLE_SQL = `CREATE TABLE IF NOT EXISTS finance_plans (
  user_id TEXT PRIMARY KEY NOT NULL,
  plan_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
)`;

const BUSINESS_PLAN_SQL = PLAN_TABLE_SQL.replace("finance_plans", "business_plans");
const PLAN_UPDATED_INDEX_SQL = "CREATE INDEX IF NOT EXISTS finance_plans_updated_at_idx ON finance_plans(updated_at)";

const USER_ACTIVITY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS user_activity (
  user_id TEXT PRIMARY KEY NOT NULL,
  email_mask TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`;

const USER_ACTIVITY_LAST_SEEN_INDEX_SQL = "CREATE INDEX IF NOT EXISTS user_activity_last_seen_at_idx ON user_activity(last_seen_at)";

const SHARE_SCHEMA = [`CREATE TABLE IF NOT EXISTS workspace_shares (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace TEXT NOT NULL CHECK (workspace IN ('private','business')),
  recipient_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('view','edit')),
  accepted_by TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  UNIQUE(owner_id, workspace, recipient_id)
)`,
`CREATE INDEX IF NOT EXISTS workspace_shares_recipient ON workspace_shares(recipient_id)`,
`CREATE TABLE IF NOT EXISTS workspace_invite_mail_limits (
  bucket TEXT PRIMARY KEY NOT NULL,
  day TEXT NOT NULL,
  sent INTEGER NOT NULL
)`];

let schemaReady: Promise<D1Database> | undefined;

export function ensurePlanSchema() {
  return schemaReady ??= initializeSchema().catch(error => {
    schemaReady = undefined;
    throw error;
  });
}

async function initializeSchema() {
  const db = env.DB;
  if (!db) throw new Error("D1 binding DB is unavailable");
  for (const statement of [USER_TABLE_SQL, PLAN_TABLE_SQL, BUSINESS_PLAN_SQL, PLAN_UPDATED_INDEX_SQL, USER_ACTIVITY_TABLE_SQL, USER_ACTIVITY_LAST_SEEN_INDEX_SQL, ...SHARE_SCHEMA]) {
    await db.prepare(statement).run();
  }
  return db;
}
