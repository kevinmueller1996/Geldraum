import { NextRequest } from "next/server";
import { getSessionIdentity } from "../password-auth";
import { isPlan } from "../plan-validation";
import { base, hash, issuer, randomToken, tokenShape } from "./config";
import { applyChanges, prepareChanges } from "./finance";
import { McpUserError } from "./mcp";
import { credentialValid, formData } from "./oauth";
import { escapeHtml, loginPage, page, manageLink } from "./pages";
import { cleanup, currentPlan, db, ensureTables } from "./storage";

const lifetime = 15 * 60_000;
export type Grant = {id:string;user_id:string;scope:string};

export async function grantFor(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !tokenShape.test(auth.slice(7))) return null;
  await ensureTables();
  return db().prepare(`SELECT id,user_id,scope FROM njora_plugin_grants WHERE access_hash=? AND access_until>? AND ${credentialValid}`)
    .bind(await hash(auth.slice(7)),Date.now()).first<Grant>();
}

export async function propose(grant: Grant, actions: unknown) {
  const {plan,revision} = await currentPlan(grant.user_id);
  const now = Date.now(), expires = now+lifetime;
  let prepared: ReturnType<typeof prepareChanges>;
  try { prepared = prepareChanges(plan,actions,new Date(now)); }
  catch (e) { throw new McpUserError(e instanceof Error ? e.message : "Prüfe die Änderungsangaben."); }
  await cleanup(now);
  const key = randomToken();
  const inserted = await db().prepare(`INSERT INTO njora_plugin_proposals(id,grant_id,revision,actions,summary,expires)
    SELECT ?,id,?,?,?,? FROM njora_plugin_grants WHERE id=? AND user_id=? AND scope='njora:read njora:write'
    AND access_until>? AND ${credentialValid}
    AND (SELECT count(*) FROM njora_plugin_proposals WHERE grant_id=?)<25`)
    .bind(await hash(key),revision,JSON.stringify(prepared.actions),JSON.stringify(prepared.preview),expires,grant.id,grant.user_id,now,grant.id).run();
  if (!inserted.meta.changes) throw new McpUserError("Der Vorschlag konnte nicht angelegt werden. Prüfe die Verbindung oder schließe offene Vorschläge ab.");
  return {confirmationUrl:issuer+base+"/confirm?id="+key,summary:prepared.preview.join("\n"),expiresAt:new Date(expires).toISOString()};
}

export async function confirm(request: NextRequest) {
  const url = new URL(request.url), key = url.searchParams.get("id") ?? "";
  if (!tokenShape.test(key)) return page("Ungültiger Vorschlag","<p>Erstelle den Vorschlag erneut in ChatGPT.</p>",400);
  if (request.method === "POST" && request.headers.get("origin") !== issuer) return page("Anfrage abgelehnt","<p>Öffne den Link direkt auf njora.de.</p>",403);
  const user = await getSessionIdentity(request);
  if (!user) return loginPage(url);
  await ensureTables();
  const id = await hash(key), now = Date.now();
  const permitted = `SELECT id FROM njora_plugin_grants WHERE user_id=? AND scope='njora:read njora:write' AND expires>? AND ${credentialValid}`;
  const row = await db().prepare(`SELECT revision,actions,summary,expires FROM njora_plugin_proposals WHERE id=? AND expires>? AND grant_id IN (${permitted})`)
    .bind(id,now,user.id,now).first<{revision:number;actions:string;summary:string;expires:number}>();
  if (!row) return page("Vorschlag nicht verfügbar","<p>Der Link wurde bereits verwendet, ist abgelaufen oder gehört zu einem anderen Konto.</p>",404);
  if (request.method === "GET") {
    const lines = JSON.parse(row.summary) as string[];
    return page("Änderungen prüfen",`<p>Für dein Njora-Konto <strong>${escapeHtml(user.email)}</strong>:</p><ul>${lines.map(line=>"<li>"+escapeHtml(line)+"</li>").join("")}</ul>
      <p>Nach der Bestätigung erscheinen die Änderungen im synchronisierten Finanzplan.</p>
      <form method="post"><div class="actions"><button name="decision" value="apply">Änderungen übernehmen</button><button class="secondary" name="decision" value="cancel">Verwerfen</button></div></form>${manageLink}`);
  }
  const form = await formData(request);
  if (form?.get("decision") === "cancel") {
    await db().prepare("DELETE FROM njora_plugin_proposals WHERE id=?").bind(id).run();
    return page("Vorschlag verworfen",'<a href="/">Zurück zu Njora</a>');
  }
  if (form?.get("decision") !== "apply") return page("Bestätigung fehlt","",400);
  const {plan,revision} = await currentPlan(user.id);
  const conflict = () => page("Finanzplan inzwischen geändert","<p>Bitte erstelle auf Basis des aktuellen Plans einen neuen Vorschlag in ChatGPT.</p>",409);
  if (row.revision !== revision) return conflict();
  let updated;
  try { updated = applyChanges(plan, JSON.parse(row.actions), new Date(row.expires-lifetime)); }
  catch { return conflict(); }
  const serialized = JSON.stringify(updated);
  if (!isPlan(updated) || new TextEncoder().encode(serialized).byteLength > 500000)
    return page("Änderung nicht möglich","<p>Der geänderte Plan überschreitet eine Grenze von Njora.</p>",422);
  const stamp = Date.now();
  const result = await db().batch([
    db().prepare(`UPDATE finance_plans SET plan_json=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?
      AND EXISTS(SELECT 1 FROM njora_plugin_proposals WHERE id=? AND expires>? AND grant_id IN (${permitted}))`)
      .bind(serialized,new Date(stamp).toISOString(),user.id,revision,id,stamp,user.id,stamp),
    db().prepare("DELETE FROM njora_plugin_proposals WHERE id=?").bind(id)
  ]);
  if (!result[0].meta.changes) return conflict();
  return page("Änderungen gespeichert",'<p>Die bestätigten Posten wurden in deinen Finanzplan übernommen.</p><a class="button" href="/">Finanzplan öffnen</a>');
}

