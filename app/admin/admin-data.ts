import { env } from "cloudflare:workers";
import { userId } from "../password-auth";

export type Tester = {
  testerCode: string;
  emailMask: string;
  firstSeenAt: string;
  lastSeenAt: string;
  accessCount: number;
  hasPlan: boolean;
  planRevision: number | null;
};

export type AdminData = {
  generatedAt: string;
  summary: { total: number; active24h: number; active7d: number; withPlan: number };
  testers: Tester[];
};

type TesterRow = {
  user_id: string;
  email_mask: string | null;
  first_seen_at: string;
  last_seen_at: string;
  access_count: number;
  plan_revision: number | null;
};

const USER_ACTIVITY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS user_activity (
  user_id TEXT PRIMARY KEY NOT NULL,
  email_mask TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`;

export async function loadAdminData(): Promise<AdminData> {
  const db = env.DB;
  if (!db) throw new Error("D1 binding DB is unavailable");
  await db.prepare(USER_ACTIVITY_TABLE_SQL).run();
  const localPreviewId = await userId("local-preview@geldraum.app");
  const result = await db.prepare(`SELECT
      users.id AS user_id,
      activity.email_mask,
      COALESCE(activity.first_seen_at, users.created_at) AS first_seen_at,
      COALESCE(activity.last_seen_at, users.updated_at) AS last_seen_at,
      COALESCE(activity.access_count, 0) AS access_count,
      plans.revision AS plan_revision
    FROM users
    LEFT JOIN user_activity AS activity ON activity.user_id = users.id
    LEFT JOIN finance_plans AS plans ON plans.user_id = users.id
    WHERE users.id != ? AND (activity.source IS NULL OR activity.source IN ('siwc', 'password'))
    ORDER BY COALESCE(activity.last_seen_at, users.updated_at) DESC`)
    .bind(localPreviewId).all<TesterRow>();

  const now = Date.now();
  const testers = result.results.map((row) => ({
    testerCode: `T-${row.user_id.slice(0, 10).toUpperCase()}`,
    emailMask: row.email_mask ?? "Noch nicht erfasst",
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    accessCount: row.access_count,
    hasPlan: row.plan_revision !== null,
    planRevision: row.plan_revision,
  }));
  return {
    generatedAt: new Date(now).toISOString(),
    summary: {
      total: testers.length,
      active24h: testers.filter((item) => now - Date.parse(item.lastSeenAt) <= 86_400_000).length,
      active7d: testers.filter((item) => now - Date.parse(item.lastSeenAt) <= 604_800_000).length,
      withPlan: testers.filter((item) => item.hasPlan).length,
    },
    testers,
  };
}
