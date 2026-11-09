import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import { equalSecret, isAdminAuthenticated } from "../../../admin/admin-auth";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../../vercel/proxy-api";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  const runtimeEnv = env as typeof env & { NJORA_BACKUP_EXPORT_TOKEN?: string };
  const expectedToken = runtimeEnv.NJORA_BACKUP_EXPORT_TOKEN?.trim() ?? "";
  const providedToken = request.headers.get("x-njora-backup-token") ?? "";
  const tokenAuthenticated = Boolean(expectedToken && providedToken && await equalSecret(providedToken, expectedToken));
  if (!tokenAuthenticated && !await isAdminAuthenticated()) return jsonError("Nicht autorisiert.", 401);

  try {
    const db = env.DB;
    if (!db) throw new Error("D1 binding DB is unavailable");

    const results = await db.batch([
      db.prepare("SELECT id, display_name, created_at, updated_at FROM users ORDER BY id"),
      db.prepare("SELECT user_id, plan_json, schema_version, revision, created_at, updated_at FROM finance_plans ORDER BY user_id"),
      db.prepare("SELECT user_id, email_mask, first_seen_at, last_seen_at, access_count, source FROM user_activity ORDER BY user_id"),
      db.prepare("SELECT user_id, email_mask, email_address, email_verified_at, password_salt, password_hash, password_iterations, created_at, updated_at FROM auth_credentials ORDER BY user_id"),
    ]);
    const [users, financePlans, userActivity, authCredentials] = results.map((result) => result.results);
    const exportedAt = new Date().toISOString();
    const filename = `njora-datenbank-${exportedAt.slice(0, 10)}.json`;
    const body = JSON.stringify({
      format: "njora-database-backup",
      version: 1,
      exportedAt,
      excludes: ["auth_sessions", "auth_action_tokens", "auth_attempts"],
      tables: {
        users,
        finance_plans: financePlans,
        user_activity: userActivity,
        auth_credentials: authCredentials,
      },
    }, null, 2);

    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, private",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Admin backup failed", error instanceof Error ? error.message : "Unknown error");
    return jsonError("Die Datenbanksicherung konnte nicht erstellt werden.", 503);
  }
}
