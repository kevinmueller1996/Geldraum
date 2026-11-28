import { ensureAuthSchema } from "../../../password-auth";
import { ensurePlanSchema } from "../../../plan-schema";
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
    await ensureAuthSchema();
    const db = await ensurePlanSchema();

    const hasSubscriptions = await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='njora_subscribers'").first();
    const hasBusinessBilling = await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='njora_business_subscribers'").first();
    const results = await db.batch([
      db.prepare("SELECT id, display_name, created_at, updated_at FROM users ORDER BY id"),
      db.prepare("SELECT user_id, plan_json, schema_version, revision, created_at, updated_at FROM finance_plans ORDER BY user_id"),
      db.prepare("SELECT user_id, email_mask, first_seen_at, last_seen_at, access_count, source FROM user_activity ORDER BY user_id"),
      db.prepare("SELECT user_id, email_mask, email_address, email_verified_at, password_salt, password_hash, password_iterations, created_at, updated_at FROM auth_credentials ORDER BY user_id"),
      db.prepare("SELECT user_id, plan_json, schema_version, revision, created_at, updated_at FROM business_plans ORDER BY user_id"),
      db.prepare("SELECT subject,user_id,client_id,encrypted_refresh_token,authorized_at FROM auth_apple_identities ORDER BY user_id"),
      db.prepare("SELECT email_id,user_id,email_address,verified_at FROM auth_email_aliases ORDER BY user_id"),
      ...(hasSubscriptions ? [db.prepare("SELECT user_id, account_token, stripe_customer, apple_original, apple_environment FROM njora_subscribers ORDER BY user_id")] : []),
      ...(hasBusinessBilling ? [db.prepare("SELECT user_id, account_token, stripe_customer, apple_original, apple_environment FROM njora_business_subscribers ORDER BY user_id")] : []),
    ]);
    const [users, financePlans, userActivity, authCredentials, businessPlans, appleIdentities, emailAliases] = results.map((result) => result.results);
    const subscribers = hasSubscriptions ? results[7].results : undefined;
    const businessBilling = hasBusinessBilling ? results[hasSubscriptions ? 8 : 7].results : [];
    const hasAppleData = appleIdentities.length > 0 || emailAliases.length > 0;
    const exportedAt = new Date().toISOString();
    const filename = `njora-datenbank-${exportedAt.slice(0, 10)}.json`;
    const body = JSON.stringify({
      format: "njora-database-backup",
      version: hasAppleData ? 5 : businessBilling.length ? 4 : businessPlans.length ? 3 : subscribers ? 2 : 1,
      exportedAt,
      excludes: ["auth_sessions", "auth_action_tokens", "auth_attempts", "auth_apple_challenges", "auth_email_alias_codes", "njora_plugin_grants", "njora_plugin_proposals", "njora_cancellation_limits"],
      tables: {
        users,
        finance_plans: financePlans,
        user_activity: userActivity,
        auth_credentials: authCredentials,
        ...(businessPlans.length || businessBilling.length ? { business_plans: businessPlans, njora_subscribers: subscribers ?? [] } : {}),
        ...(businessBilling.length ? { njora_business_subscribers: businessBilling } : {}),
        ...(subscribers ? { njora_subscribers: subscribers } : {}),
        ...(hasAppleData ? {business_plans: businessPlans, njora_subscribers: subscribers ?? [], njora_business_subscribers: businessBilling,
          auth_apple_identities: appleIdentities, auth_email_aliases: emailAliases} : {}),
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
