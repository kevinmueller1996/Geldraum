import { NextRequest } from "next/server";
import { getSessionIdentity } from "../password-auth";
import { base, clientId, hash, issuer, randomToken, redirectUri, resource, scopeSet, tokenShape } from "./config";
import { page, loginPage, escapeHtml } from "./pages";
import { cleanup, db, ensureTables } from "./storage";

export const credentialValid = "credential_version = (SELECT updated_at FROM auth_credentials c WHERE c.user_id = njora_plugin_grants.user_id)";
const fiveMinutes = 300_000;
const halfHour = 1_800_000;
const month = 30 * 86_400_000;

export function oauthJson(body: object, status = 200) {
  return Response.json(body, {status, headers:{"cache-control":"no-store",pragma:"no-cache"}});
}

export async function formData(request: Request) {
  if (request.method !== "POST" || !request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return null;
  const text = await request.text();
  if (text.length > 6000) return null;
  const params = new URLSearchParams(text);
  if ([...params.keys()].some(k => params.getAll(k).length !== 1)) return null;
  return params;
}

function returnToClient(params: URLSearchParams, result: Record<string,string>) {
  const url = new URL(redirectUri);
  url.search = new URLSearchParams({...result, iss:issuer, state:params.get("state")!}).toString();
  return new Response(null,{status:303,headers:{location:url.href,"cache-control":"no-store","referrer-policy":"no-referrer"}});
}

export async function authorize(request: NextRequest) {
  const url = new URL(request.url);
  const p = url.searchParams;
  const scope = scopeSet(p.get("scope"));
  const challenge = p.get("code_challenge") ?? "";
  if ([...p.keys()].some(k=>p.getAll(k).length!==1) || url.search.length > 5000 ||
      p.get("client_id") !== clientId || p.get("redirect_uri") !== redirectUri ||
      p.get("response_type") !== "code" || p.get("resource") !== resource || !scope ||
      !tokenShape.test(challenge) || p.get("code_challenge_method") !== "S256" ||
      !p.get("state") || p.get("state")!.length > 1024)
    return page("Ungültige Verbindungsanfrage","<p>Starte die Verbindung erneut in ChatGPT.</p>",400);
  if (request.method === "POST" && request.headers.get("origin") !== issuer) return oauthJson({error:"invalid_request"},403);
  const identity = await getSessionIdentity(request);
  if (!identity) return loginPage(url);
  if (request.method === "GET") {
    const writes = scope.includes("njora:write");
    return page("Njora mit ChatGPT verbinden",`<p>Du bist als <strong>${escapeHtml(identity.email)}</strong> angemeldet. Erlaube ChatGPT für dieses Konto:</p>
      <ul><li>Einkommen, Kosten und Fälligkeiten für deine Fragen auswerten.</li>
      ${writes ? "<li>Änderungen vorschlagen. Jede Übernahme bestätigst du separat auf njora.de.</li>" : ""}</ul>
      <p>Die angefragten Ergebnisse werden an ChatGPT übermittelt. Du kannst den Zugriff jederzeit in Njora widerrufen.</p>
      <form method="post"><div class="actions"><button name="decision" value="allow">Zugriff erlauben</button><button class="secondary" name="decision" value="deny">Ablehnen</button></div></form>`);
  }
  const form = await formData(request);
  if (form?.get("decision") === "deny") return returnToClient(p,{error:"access_denied"});
  if (form?.get("decision") !== "allow") return oauthJson({error:"invalid_request"},400);
  await ensureTables();
  const now = Date.now();
  await cleanup(now);
  const code = randomToken();
  const result = await db().prepare(`INSERT INTO njora_plugin_grants
    (id,user_id,scope,code_hash,challenge,code_until,expires,credential_version)
    SELECT ?,user_id,?,?,?,?,?,updated_at FROM auth_credentials WHERE user_id=?`)
    .bind(crypto.randomUUID(),scope,await hash(code),challenge,now+fiveMinutes,now+fiveMinutes,identity.id).run();
  if (!result.meta.changes) return oauthJson({error:"access_denied"},403);
  return returnToClient(p,{code});
}

export async function exchange(request: Request) {
  const p = await formData(request);
  if (!p || p.get("resource") !== resource || p.get("client_id") !== clientId) return oauthJson({error:"invalid_request"},400);
  const now = Date.now();
  let where: string;
  let values: string[];
  if (p.get("grant_type") === "authorization_code") {
    const verifier = p.get("code_verifier") ?? "";
    const code = p.get("code") ?? "";
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !tokenShape.test(code) || p.get("redirect_uri") !== redirectUri)
      return oauthJson({error:"invalid_grant"},400);
    where = "code_hash=? AND challenge=?";
    values = [await hash(code),await hash(verifier)];
  } else if (p.get("grant_type") === "refresh_token") {
    const refresh = p.get("refresh_token") ?? "";
    if (!tokenShape.test(refresh)) return oauthJson({error:"invalid_grant"},400);
    where = "refresh_hash=?";
    values = [await hash(refresh)];
    if (p.has("scope")) {
      const scope = scopeSet(p.get("scope"));
      if (!scope) return oauthJson({error:"invalid_scope"},400);
      where += " AND scope=?";
      values.push(scope);
    }
  } else return oauthJson({error:"unsupported_grant_type"},400);
  await ensureTables();
  const access = randomToken(), refresh = randomToken();
  // One atomic compare-and-swap consumes the code or previous refresh token.
  const row = await db().prepare(`UPDATE njora_plugin_grants SET code_hash=NULL, challenge=NULL, code_until=NULL,
    access_hash=?,access_until=?,refresh_hash=?,expires=? WHERE ${where} AND expires>? AND ${credentialValid} RETURNING scope`)
    .bind(await hash(access),now+halfHour,await hash(refresh),now+month,...values,now).first<{scope:string}>();
  return row ? oauthJson({access_token:access,token_type:"Bearer",expires_in:halfHour/1000,refresh_token:refresh,scope:row.scope})
    : oauthJson({error:"invalid_grant"},400);
}

export async function revoke(request: Request) {
  const form = await formData(request);
  if (!form || form.get("client_id") !== clientId) return oauthJson({error:"invalid_request"},400);
  const token = form.get("token") ?? "";
  if (tokenShape.test(token)) {
    await ensureTables();
    const digest = await hash(token);
    await db().prepare("DELETE FROM njora_plugin_grants WHERE access_hash=? OR refresh_hash=?").bind(digest,digest).run();
  }
  return oauthJson({});
}
export async function manage(request: NextRequest) {
  if (request.method === "POST" && request.headers.get("origin") !== issuer) return oauthJson({error:"invalid_request"},403);
  const identity = await getSessionIdentity(request);
  if (!identity) return loginPage(new URL(request.url));
  await ensureTables();
  if (request.method === "POST") {
    const form = await formData(request);
    if (form?.get("decision") !== "revoke") return oauthJson({error:"invalid_request"},400);
    await db().prepare("DELETE FROM njora_plugin_grants WHERE user_id=?").bind(identity.id).run();
    return Response.redirect(issuer+base+"/manage",303);
  }
  const linked = await db().prepare(`SELECT 1 FROM njora_plugin_grants WHERE user_id=? AND access_hash IS NOT NULL AND expires>? AND ${credentialValid} LIMIT 1`)
    .bind(identity.id,Date.now()).first();
  return page("ChatGPT-Verbindung",linked ?
    '<p>ChatGPT ist mit deinem Njora-Konto verbunden. Beim Trennen verfallen auch offene Änderungsvorschläge.</p><form method="post"><button name="decision" value="revoke">Verbindung trennen</button></form>'
    : '<p>Dein Njora-Konto hat keine aktive Verbindung zu ChatGPT.</p><a href="/">Zurück zu Njora</a>');
}

