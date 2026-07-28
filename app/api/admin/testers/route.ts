import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../../vercel/proxy-api";

export const dynamic = "force-dynamic";

type TesterRow = {
  user_id: string;
  email_mask: string | null;
  first_seen_at: string;
  last_seen_at: string;
  access_count: number;
  plan_revision: number | null;
  plan_updated_at: string | null;
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

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function userId(email: string) {
  const bytes = await digest(email.trim().toLowerCase());
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validToken(provided: string, expected: string) {
  const [left, right] = await Promise.all([digest(provided), digest(expected)]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function GET(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  const runtimeEnv = env as typeof env & { GELDRAUM_ADMIN_TOKEN?: string };
  const expected = runtimeEnv.GELDRAUM_ADMIN_TOKEN;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !provided || !(await validToken(provided, expected))) {
    return json({ error: "Nicht autorisiert." }, 401);
  }

  try {
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
        plans.revision AS plan_revision,
        plans.updated_at AS plan_updated_at
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
      planUpdatedAt: row.plan_updated_at,
    }));

    return json({
      generatedAt: new Date(now).toISOString(),
      privacy: {
        directIdentifiers: false,
        financialContent: false,
        purpose: "Testphasen-Monitoring",
      },
      summary: {
        total: testers.length,
        active24h: testers.filter((item) => now - Date.parse(item.lastSeenAt) <= 86_400_000).length,
        active7d: testers.filter((item) => now - Date.parse(item.lastSeenAt) <= 604_800_000).length,
        withPlan: testers.filter((item) => item.hasPlan).length,
      },
      testers,
    });
  } catch {
    return json({ error: "Die Testerübersicht konnte nicht geladen werden." }, 503);
  }
}
