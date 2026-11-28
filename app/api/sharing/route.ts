import { sendWorkspaceInvitation } from "../../auth-email";
import { NextRequest, NextResponse } from "next/server";
import { billingEnabled, membership, subscriber } from "../../billing/subscription";
import { browserSession, wrongSession } from "../../browser-session-server";
import { getSessionIdentity, normalizeEmail, userId } from "../../password-auth";
import { ensurePlanSchema } from "../../plan-schema";
import { isPlan } from "../../plan-validation";
import { normalizePlanCategories } from "../../recurring-costs";
import { readBodyBytes } from "../../request-body";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../vercel/proxy-api";

export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) => NextResponse.json(data, {status, headers:{"Cache-Control":"private, no-store"}});
const error = (message: string, status: number) => reply({error:message}, status);
const missing = () => error("Diese Freigabe ist nicht mehr verfügbar.", 404);

async function handle(req: NextRequest) {
  if (await wrongSession(req)) return error("Die Sitzung hat gewechselt.",412);
  if (needsCloudflareBackendProxy()) return proxyApiRequest(req);
  if (req.headers.get("origin") !== req.nextUrl.origin) return error("Unzulässige Anfrage.",403);
  if (!req.headers.get("content-type")?.startsWith("application/json")) return error("JSON erwartet.",415);
  const identity = await getSessionIdentity(req);
  if (!identity) return error("Bitte melde dich bei Njora an.",401);
  const db = await ensurePlanSchema();
  // Recheck the account lifetime inside each modifying statement.
  const verified = "EXISTS (SELECT 1 FROM users u JOIN auth_credentials c ON c.user_id=u.id WHERE u.id=? AND u.created_at=? AND c.email_verified_at IS NOT NULL)";
  const self = [identity.id,identity.accountCreatedAt];
  if (!await db.prepare("SELECT 1 WHERE "+verified).bind(...self).first()) return error("Bestätige zuerst deine E-Mail-Adresse.",403);
  let data;
  try { data = JSON.parse(new TextDecoder().decode(await readBodyBytes(req,req.method === "PUT" ? 600000 : 4000))); }
  catch (e) { return error("Die Anfrage ist ungültig oder zu groß.", e instanceof RangeError ? 413 : 400); }
  const { workspace, action, id } = data ?? {};
  if (workspace !== "private" && workspace !== "business") return error("Bitte wähle einen Finanzbereich.",400);
  const now = new Date().toISOString();
  const table = workspace === "business" ? "business_plans" : "finance_plans";
  const addressedToUser = "(recipient_id=? OR recipient_id IN (SELECT email_id FROM auth_email_aliases WHERE user_id=?))";
  if (req.method === "POST" && action === "list") {
    await db.prepare("DELETE FROM workspace_shares WHERE owner_id=? AND workspace=? AND accepted_by IS NULL AND expires_at<=?").bind(identity.id,workspace,now).run();
    await db.prepare("DELETE FROM workspace_invite_mail_limits WHERE day<?").bind(now.slice(0,10)).run();
    const visible = " AND (s.accepted_by IS NOT NULL OR s.expires_at>?) AND "+verified;
    const base = "SELECT s.id,s.role,s.workspace,(s.accepted_by IS NOT NULL) AS active,";
    const owned = await db.prepare(base+"s.recipient_email AS email FROM workspace_shares s WHERE s.owner_id=? AND s.workspace=?"+visible+" ORDER BY email").bind(identity.id,workspace,now,...self).all();
    const received = await db.prepare(base+"c.email_address AS email FROM workspace_shares s JOIN auth_credentials c ON c.user_id=s.owner_id WHERE (s.accepted_by=? OR (s.accepted_by IS NULL AND "+addressedToUser+")) AND s.workspace=?"+visible+" ORDER BY email")
      .bind(identity.id,identity.id,identity.id,workspace,now,...self).all();
    return reply({owned:owned.results,received:received.results});
  }
  if (req.method === "POST" && action === "invite") {
    const email = normalizeEmail(data.email);
    if (!email || !["view","edit"].includes(data.role)) return error("Bitte prüfe E-Mail-Adresse und Berechtigung.",400);
    if (billingEnabled(identity.id) && !(await membership(await subscriber(identity.id,identity.accountCreatedAt,workspace))).active) return error("Zum Einladen brauchst du ein aktives Abo für diesen Bereich.",402);
    const recipient = await userId(email);
    if (recipient === identity.id || await db.prepare("SELECT 1 FROM auth_email_aliases WHERE email_id=? AND user_id=?").bind(recipient,identity.id).first()) {
      return error("Das ist dein eigenes Konto.",400);
    }
    const expires = new Date(Date.now()+7*86400000).toISOString();
    const newId = crypto.randomUUID();
    const result = await db.prepare(`INSERT INTO workspace_shares (id,owner_id,workspace,recipient_id,recipient_email,role,expires_at)
      SELECT ?,?,?,?,?,?,? WHERE ${verified} AND (SELECT count(*) FROM workspace_shares WHERE owner_id=? AND workspace=? AND (accepted_by IS NOT NULL OR expires_at>?))<100
      ON CONFLICT(owner_id,workspace,recipient_id) DO UPDATE SET id=excluded.id,role=excluded.role,expires_at=excluded.expires_at
      WHERE accepted_by IS NULL AND expires_at<=?`).bind(newId,identity.id,workspace,recipient,email,data.role,expires,...self,identity.id,workspace,now,now).run();
    if (!result.meta.changes) return error("Für diese Adresse besteht bereits eine Freigabe oder der Bereich ist voll.",409);
    // Bound outgoing mail even if invitations are repeatedly revoked and recreated.
    const day = now.slice(0,10);
    const quota = await db.batch([["from:"+identity.id,15],["to:"+recipient,5]].map(([key,limit]) =>
      db.prepare(`INSERT INTO workspace_invite_mail_limits(bucket,day,sent) VALUES(?,?,1)
        ON CONFLICT(bucket) DO UPDATE SET day=excluded.day,sent=CASE WHEN day=excluded.day THEN sent+1 ELSE 1 END
        WHERE day<>excluded.day OR sent<?`).bind(key,day,limit)));
    const mailed = quota.every(row=>row.meta.changes) && await sendWorkspaceInvitation(email,identity.email,workspace,data.role,newId).catch(()=>false);
    return reply({ok:true,mailed});
  }
  if (typeof id !== "string" || id.length !== 36) return missing();
  if (req.method === "POST" && action === "accept") {
    const r = await db.prepare("UPDATE workspace_shares SET accepted_by=? WHERE id=? AND workspace=? AND "+addressedToUser+" AND expires_at>? AND accepted_by IS NULL AND "+verified)
      .bind(identity.id,id,workspace,identity.id,identity.id,now,...self).run();
    return r.meta.changes ? reply({ok:true}) : missing();
  }
  if (req.method === "POST" && action === "remove") {
    const r = await db.prepare("DELETE FROM workspace_shares WHERE id=? AND workspace=? AND (owner_id=? OR accepted_by=? OR (accepted_by IS NULL AND "+addressedToUser+")) AND "+verified)
      .bind(id,workspace,identity.id,identity.id,identity.id,identity.id,...self).run();
    return r.meta.changes ? reply({ok:true}) : missing();
  }
  if (action !== "plan" && !(action === "status" && req.method === "POST")) return error("Unbekannte Aktion.",400);
  const access = "s.id=? AND s.workspace=? AND s.accepted_by=? AND "+verified;
  const args = [id,workspace,identity.id,...self];
  const owner = await db.prepare("SELECT s.owner_id,u.created_at FROM workspace_shares s JOIN users u ON u.id=s.owner_id WHERE "+access)
    .bind(...args).first<{owner_id:string;created_at:string}>();
  if (!owner) return missing();
  if (billingEnabled(owner.owner_id) && !(await membership(await subscriber(owner.owner_id,owner.created_at,workspace))).active)
    return error("Für diesen Bereich ist ein aktives Abo des Inhabers erforderlich.",402);
  if (action === "status") return reply({ok:true});
  if (req.method === "POST") {
    const row = await db.prepare(`SELECT p.plan_json,p.revision,s.role,pref.basis FROM workspace_shares s LEFT JOIN dashboard_preferences pref ON pref.user_id=s.accepted_by LEFT JOIN ${table} p ON p.user_id=s.owner_id WHERE ${access}`)
      .bind(...args).first<{plan_json:string|null;revision:number|null;role:string;basis:string|null}>();
    return row ? reply({plan:row.plan_json ? normalizePlanCategories(JSON.parse(row.plan_json)) : null, revision:row.revision,role:row.role,dashboardBasis:row.basis ?? "gross"}) : missing();
  }
  if (!isPlan(data.plan) || !(data.revision === null || Number.isSafeInteger(data.revision) && data.revision>0)) return error("Bitte prüfe den Finanzplan.",400);
  const content = JSON.stringify(normalizePlanCategories(data.plan));
  if (new TextEncoder().encode(content).length>500000) return error("Der Finanzplan ist zu groß.",413);
  const editors = "SELECT s.owner_id FROM workspace_shares s WHERE "+access+" AND s.role='edit'";
  if (!await db.prepare(editors).bind(...args).first()) return error("Du hast Lesezugriff.",403);
  const changed = data.revision === null
    ? await db.prepare(`INSERT INTO ${table} (user_id,plan_json,revision,created_at,updated_at) SELECT s.owner_id,?,1,?,? FROM workspace_shares s WHERE ${access} AND s.role='edit' ON CONFLICT(user_id) DO NOTHING`).bind(content,now,now,...args).run()
    : await db.prepare(`UPDATE ${table} SET plan_json=?,revision=revision+1,updated_at=? WHERE revision=? AND user_id IN (${editors})`).bind(content,now,data.revision,...args).run();
  return changed.meta.changes ? reply({revision:(data.revision ?? 0)+1}) : error("Der Plan oder deine Freigabe hat sich geändert. Bitte lade den Bereich erneut.",409);
}

export async function POST(req: NextRequest) {
  try {
    const response = await handle(req);
    if (response.ok && req.headers.get("x-njora-browser") === "1") {
      response.headers.set("x-njora-browser-session", await browserSession(req));
    }
    return response;
  } catch { return error("Freigaben sind gerade nicht erreichbar.",503); }
}
export const PUT = POST;
