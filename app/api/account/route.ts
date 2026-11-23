import { readBodyBytes } from "../../request-body";
import { closingPrices } from "../../market/cboe";
import { securityISIN } from "../../market/closing-prices";
import { browserSession, wrongSession } from "../../browser-session-server";
import { BillingCancellationUnconfirmed, billingEnabled, membership, removeBillingAccount, subscriber } from "../../billing/subscription";
import { normalizePlanCategories } from "../../recurring-costs";
import { isPlan } from "../../plan-validation";
import { markerName } from "../../browser-session";
import { ensurePlanSchema } from "../../plan-schema";
import { NextRequest, NextResponse } from "next/server";
import { isLocalHostname } from "../../local-host";
import { clearSessionCookie, ensureAuthSchema, getSessionIdentity, maskEmail, userId } from "../../password-auth";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../vercel/proxy-api";

export const dynamic = "force-dynamic";

type Identity = { id: string; displayName: string; email: string; emailMask: string; local: boolean; accountCreatedAt?: string };

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}

async function requestIdentity(request: NextRequest): Promise<Identity | null> {
  const authenticated = await getSessionIdentity(request);
  if (authenticated) return authenticated;

  const hostname = new URL(request.url).hostname;
  if (isLocalHostname(hostname)) {
    const email = "local-preview@geldraum.app";
    return { id: await userId(email), displayName: "Lokale Version", email, emailMask: maskEmail(email), local: true };
  }

  return null;
}

async function upsertUser(identity: Identity, recordAccess = false) {
  const db = await ensurePlanSchema();
  const id = identity.id;
  const now = new Date().toISOString();
  if (identity.local) await db.prepare(`INSERT INTO users (id, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`)
    .bind(id, identity.displayName, now, now).run();
  if (recordAccess) {
    await db.prepare(`INSERT INTO user_activity (user_id, email_mask, first_seen_at, last_seen_at, access_count, source)
      SELECT id, ?, ?, ?, 1, ? FROM users WHERE id=? AND (? IS NULL OR created_at=?)
      ON CONFLICT(user_id) DO UPDATE SET
        email_mask = excluded.email_mask,
        last_seen_at = excluded.last_seen_at,
        access_count = user_activity.access_count + 1,
        source = excluded.source`)
      .bind(identity.emailMask, now, now, identity.local ? "local" : "password", id, identity.accountCreatedAt ?? null, identity.accountCreatedAt ?? null).run();
  }
  return { db, id, now };
}

export async function GET(request: NextRequest) {
  if (await wrongSession(request)) return json({error: "Die Sitzung hat gewechselt."}, 412);
  let response = await getAccount(request);
  const requested = request.headers.get("x-njora-closing-prices");
  if (response.ok && requested !== null && requested.length <= 1400) {
    const payload = await response.clone().json();
    if (payload.authenticated && payload.billing?.active !== false) {
      const symbols: string[] = Array.isArray(payload.plan?.savings)
        ? payload.plan.savings.filter((s: {kind:string}) => s.kind === "security").map((s: {symbol?:string}) => s.symbol) : [];
      const ids = new Set([...symbols, ...requested.split(",")].filter(v => typeof v === "string").map(securityISIN).filter(Boolean));
      if (ids.size) {
        // A market-data outage must never block access to an otherwise valid financial plan.
        const quotes = await closingPrices(ids).catch(error => {
          console.warn("Cboe closing prices unavailable", error instanceof Error ? error.message : "Unknown error");
          return null;
        });
        response = NextResponse.json({...payload, closingPrices:quotes}, {headers:response.headers});
      }
    }
  }
  if (response.ok && request.headers.get("x-njora-browser") === "1") {
    const token = await browserSession(request);
    if (token) {
      response.headers.set("X-Njora-Browser-Session", token);
      const name = markerName(request.nextUrl.hostname);
      if (request.cookies.get(name)?.value !== token) {
        response.headers.append("Set-Cookie", name + "=" + token + "; Path=/; SameSite=Lax; Max-Age=2592000" +
          (isLocalHostname(request.nextUrl.hostname) ? "" : "; Secure"));
      }
    }
  }
  return response;
}

function planTable(request: NextRequest) {
  return request.nextUrl.pathname.replace(/\/$/, "") === "/api/account/business" ? "business_plans" : "finance_plans";
}

async function getAccount(request: NextRequest) {
  if (needsCloudflareBackendProxy()) {
    const response = await proxyApiRequest(request);
    if (response.status !== 200 || !response.headers.get("content-type")?.includes("application/json")) return response;
    const payload = await response.json();
    return NextResponse.json({ ...payload, plan: normalizePlanCategories(payload.plan) }, { headers: response.headers });
  }
  const identity = await requestIdentity(request);
  if (!identity) return json({ authenticated: false }, 401);

  try {
    const { db, id } = await upsertUser(identity, true);
    const billing = billingEnabled(id) && !identity.local ? await membership(await subscriber(id, identity.accountCreatedAt, planTable(request) === "business_plans" ? "business" : "private")) : null;
    const table = planTable(request);
    const otherTable = table === "business_plans" ? "finance_plans" : "business_plans";
    const result = await db.prepare(`SELECT users.created_at, pref.basis AS dashboard_basis, p.plan_json, p.revision, p.updated_at,
        json_extract(other.plan_json, '$.name') AS other_name
      FROM users LEFT JOIN dashboard_preferences pref ON pref.user_id=users.id LEFT JOIN ${table} p ON p.user_id=users.id
      LEFT JOIN ${otherTable} other ON other.user_id=users.id
      WHERE users.id=? AND (? IS NULL OR users.created_at=?)`)
      .bind(id, identity.accountCreatedAt ?? null, identity.accountCreatedAt ?? null)
      .first<{ created_at: string; dashboard_basis: string | null; other_name: string | null; plan_json: string | null; revision: number | null; updated_at: string | null }>();
    if (!result) return json({ authenticated: false }, 401);
    return json({
      authenticated: true, billing, otherWorkspaceName: result.other_name, workspace: table === "business_plans" ? "business" : "private",
      user: { displayName: identity.displayName, email: identity.email, local: identity.local, accountCreatedAt: result.created_at, dashboardBasis: result.dashboard_basis ?? "gross" },
      plan: result.plan_json ? normalizePlanCategories(JSON.parse(result.plan_json)) : null,
      revision: result.revision,
      updatedAt: result.updated_at,
    });
  } catch {
    return json({ error: "Dein Konto konnte gerade nicht geladen werden." }, 503);
  }
}

export async function PUT(request: NextRequest) {
  if (await wrongSession(request)) return json({error: "Die Sitzung hat gewechselt."}, 412);
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  if (!isSameOrigin(request)) return json({ error: "Unzulässige Anfrage." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "JSON erwartet." }, 415);
  const identity = await requestIdentity(request);
  if (!identity) return json({ authenticated: false }, 401);

  try {
    if (billingEnabled(identity.id) && !identity.local && !(await membership(await subscriber(identity.id, identity.accountCreatedAt, planTable(request) === "business_plans" ? "business" : "private"))).active) return json({error:"Für Änderungen brauchst du ein aktives Njora-Abo."},402);
    let body: { plan?: unknown; revision?: number | null } | null;
    try {
      const bytes = await readBodyBytes(request, 600_000);
      body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch (error) {
      if (error instanceof RangeError) return json({ error: "Der Finanzplan ist zu groß." }, 413);
      return json({ error: "Ungültiger Finanzplan." }, 400);
    }
    if (!body || !isPlan(body.plan)) return json({ error: "Ungültiger Finanzplan." }, 400);
    const planJson = JSON.stringify(normalizePlanCategories(body.plan));
    if (new TextEncoder().encode(planJson).byteLength > 500_000) return json({ error: "Der Finanzplan ist zu groß." }, 413);

    const { db, id, now } = await upsertUser(identity);
    const table = planTable(request);
    const existing = await db.prepare(`SELECT revision FROM ${table} WHERE user_id = ?`).bind(id).first<{ revision: number }>();
    if (!existing) {
      if (body.revision != null) return json({ error: "Der bisherige Finanzplan existiert nicht mehr.", revision: null }, 409);
      const inserted = await db.prepare(`INSERT INTO ${table} (user_id, plan_json, schema_version, revision, created_at, updated_at)
        SELECT id, ?, 1, 1, ?, ? FROM users WHERE id=? AND (? IS NULL OR created_at=?) ON CONFLICT(user_id) DO NOTHING`)
        .bind(planJson, now, now, id, identity.accountCreatedAt ?? null, identity.accountCreatedAt ?? null).run();
      if (!inserted.meta.changes) return json({ error: "Der Finanzplan wurde zwischenzeitlich geändert." }, 409);
      return json({ saved: true, revision: 1, updatedAt: now });
    }

    if (body.revision !== existing.revision) return json({ error: "Der Finanzplan wurde zwischenzeitlich auf einem anderen Gerät geändert.", revision: existing.revision }, 409);
    const nextRevision = existing.revision + 1;
    const result = await db.prepare(`UPDATE ${table} SET plan_json = ?, schema_version = 1, revision = ?, updated_at = ? WHERE user_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM users WHERE id=${table}.user_id AND (? IS NULL OR created_at=?))`)
      .bind(planJson, nextRevision, now, id, existing.revision, identity.accountCreatedAt ?? null, identity.accountCreatedAt ?? null).run();
    if (!result.meta.changes) return json({ error: "Der Finanzplan wurde zwischenzeitlich geändert." }, 409);
    return json({ saved: true, revision: nextRevision, updatedAt: now });
  } catch {
    return json({ error: "Deine Änderungen konnten gerade nicht gespeichert werden." }, 503);
  }
}

// A display preference belongs to the signed-in person, independently of plan ownership or billing.
export async function PATCH(request: NextRequest) {
  if (await wrongSession(request)) return json({error: "Die Sitzung hat gewechselt."}, 412);
  if (!isSameOrigin(request)) return json({error: "Unzulässige Anfrage."}, 403);
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({error: "JSON erwartet."}, 415);
  const identity = await requestIdentity(request);
  if (!identity) return json({authenticated: false}, 401);
  let basis: unknown;
  try {
    basis = JSON.parse(new TextDecoder().decode(await readBodyBytes(request, 256)))?.dashboardBasis;
  } catch { return json({error: "Ungültige Dashboard-Einstellung."}, 400); }
  if (basis !== "gross" && basis !== "net") return json({error: "Bitte Brutto oder Netto auswählen."}, 400);
  try {
    const {db, id} = await upsertUser(identity);
    const lifetime = identity.accountCreatedAt ?? null;
    const result = await db.prepare(`INSERT INTO dashboard_preferences (user_id, basis)
      SELECT id, ? FROM users WHERE id=? AND (? IS NULL OR created_at=?)
      ON CONFLICT(user_id) DO UPDATE SET basis=excluded.basis`).bind(basis, id, lifetime, lifetime).run();
    return result.meta.changes ? json({dashboardBasis: basis}) : json({authenticated: false}, 401);
  } catch { return json({error: "Die Standardansicht konnte nicht gespeichert werden."}, 503); }
}

export async function DELETE(request: NextRequest) {
  if (await wrongSession(request)) return json({error: "Die Sitzung hat gewechselt."}, 412);
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  if (!isSameOrigin(request)) return json({ error: "Unzulässige Anfrage." }, 403);
  const identity = await requestIdentity(request);
  if (!identity) return json({ authenticated: false }, 401);

  try {
    await ensureAuthSchema();
    const db = await ensurePlanSchema();
    const id = identity.id;
    // Provider cancellation can take time. Tie every write to the account which
    // authorized the request, even if the email is registered again in between.
    const created = identity.accountCreatedAt ?? null;
    // If a checkout linked a customer after cancellation began, leave the data
    // intact so a retry can cancel that customer before removing the account.
    const noSubscriber = " AND NOT EXISTS (SELECT 1 FROM njora_subscribers WHERE user_id=users.id) AND NOT EXISTS (SELECT 1 FROM njora_business_subscribers WHERE user_id=users.id)";
    const guard = " AND EXISTS (SELECT 1 FROM users WHERE id=? AND (? IS NULL OR created_at=?)" + noSubscriber + ")";
    const owned = (sql: string) => db.prepare(sql + guard).bind(id, id, created, created);
    const deleted = await db.batch([
      ...await removeBillingAccount(id, created),
      owned("DELETE FROM workspace_shares WHERE recipient_id=?"),
      owned("DELETE FROM finance_plans WHERE user_id=?"),
      owned("DELETE FROM business_plans WHERE user_id=?"),
      owned("DELETE FROM user_activity WHERE user_id=?"),
      owned("DELETE FROM auth_sessions WHERE user_id=?"),
      owned("DELETE FROM auth_action_tokens WHERE user_id=?"),
      owned("DELETE FROM auth_credentials WHERE user_id=?"),
      owned("DELETE FROM auth_attempts WHERE email_hash=?"),
      db.prepare("DELETE FROM users WHERE id=? AND (? IS NULL OR created_at=?)" + noSubscriber).bind(id, created, created),
    ]);
    if (!deleted[deleted.length - 1].meta.changes) return json({ error: "Das Konto wurde inzwischen geändert. Bitte prüfe den aktuellen Stand." }, 409);
    const response = json({ deleted: true });
    clearSessionCookie(response, request);
    return response;
  } catch (error) {
    if (error instanceof BillingCancellationUnconfirmed) return json({ error: error.message, code: "billing_cancellation_unconfirmed" }, 503);
    return json({ error: "Dein Konto konnte gerade nicht gelöscht werden." }, 503);
  }
}
