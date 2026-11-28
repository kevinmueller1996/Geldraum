import { env } from "cloudflare:workers";
import {
  APPLE_CREDENTIAL_SCHEME, createAppleSession, ensureAuthSchema,
  maskEmail, normalizeEmail, userId,
} from "./password-auth";
import {
  hashAppleValue, openAppleRefreshToken, randomAppleValue,
  sealAppleRefreshToken, signAppleClientSecret, verifyAppleToken,
} from "./apple-tokens";
import { authPublicOrigin } from "./auth-email";

type AppleEnv = typeof env & {
  AUTH_APPLE_ENABLED?: string;
  AUTH_APPLE_WEB_CLIENT_ID?: string;
  AUTH_APPLE_TEAM_ID?: string;
  AUTH_APPLE_KEY_ID?: string;
  AUTH_APPLE_PRIVATE_KEY?: string;
  AUTH_APPLE_TOKEN_KEY?: string;
};

export const appleBrowserCookie = "__Host-njora_apple";
export const appleNativeClientID = "de.njora.finanzueberblick";
const appleURL = "https://appleid.apple.com";
const runtime = env as AppleEnv;
const challengeSeconds = 300;
const destinations = ["/freigaben", "/api/chatgpt/authorize", "/api/chatgpt/confirm", "/api/chatgpt/manage"];
const validRandomValue = /^[A-Za-z0-9_-]{43}$/;
export type ApplePlatform = "web" | "native";
export type ApplePurpose = "register" | "login" | "link";
type Challenge = {nonce: string; purpose: ApplePurpose; destination: string; session_hash: string | null};
type AppleIdentity = {subject: string; user_id: string; client_id: string; encrypted_refresh_token: string};
type AppleJWK = JsonWebKey & {kid: string};

export class AppleAuthError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

export { appleErrors } from "./apple-auth-messages";

export function appleConfigured(platform: ApplePlatform) {
  return runtime.AUTH_APPLE_ENABLED === "1" && Boolean(runtime.AUTH_APPLE_TEAM_ID?.trim() &&
    runtime.AUTH_APPLE_KEY_ID?.trim() && runtime.AUTH_APPLE_PRIVATE_KEY?.trim() &&
    /^[A-Za-z0-9_-]{43}$/.test(runtime.AUTH_APPLE_TOKEN_KEY?.trim() ?? "") &&
    (platform === "native" || runtime.AUTH_APPLE_WEB_CLIENT_ID?.trim()));
}

function clientID(platform: ApplePlatform) {
  return platform === "native" ? appleNativeClientID : runtime.AUTH_APPLE_WEB_CLIENT_ID!.trim();
}

function callbackURL() {
  return new URL("/api/auth/apple/callback", authPublicOrigin()).href;
}

function secret(id: string) {
  return signAppleClientSecret(id, runtime.AUTH_APPLE_TEAM_ID!.trim(), runtime.AUTH_APPLE_KEY_ID!.trim(), runtime.AUTH_APPLE_PRIVATE_KEY!);
}

function safeDestination(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 3000) return "/";
  const origin = authPublicOrigin();
  const url = new URL(value, origin);
  return url.origin === origin.origin && destinations.includes(url.pathname) ? url.pathname + url.search : "/";
}

export function applePurpose(value: unknown): ApplePurpose {
  if (value !== "login" && value !== "register" && value !== "link") throw new AppleAuthError("apple_expired");
  return value;
}

export async function beginAppleAuth(platform: ApplePlatform, purpose: ApplePurpose, sessionHash: string | null, destination: unknown) {
  if (!appleConfigured(platform)) throw new AppleAuthError("apple_unavailable", 503);
  if (purpose === "link" && !sessionHash) throw new AppleAuthError("apple_session", 401);
  const state = randomAppleValue(), nonce = randomAppleValue();
  const browser = platform === "web" ? randomAppleValue() : null;
  const now = Date.now();
  const db = await ensureAuthSchema();
  await db.batch([
    db.prepare("DELETE FROM auth_apple_challenges WHERE expires_at <= ?").bind(new Date(now).toISOString()),
    db.prepare(`INSERT INTO auth_apple_challenges (state_hash,nonce,expires_at,platform,purpose,browser_hash,session_hash,destination)
      VALUES (?,?,?,?,?,?,?,?)`).bind(await hashAppleValue(state), nonce, new Date(now + challengeSeconds * 1000).toISOString(),
      platform, purpose, browser && await hashAppleValue(browser), sessionHash, safeDestination(destination)),
  ]);
  const url = new URL("/auth/authorize", appleURL);
  url.search = new URLSearchParams({
    client_id: clientID(platform), redirect_uri: callbackURL(), response_type: "code",
    response_mode: "form_post", scope: "email", state, nonce,
  }).toString();
  return {state, nonce, browser, url, expiresIn: challengeSeconds};
}

async function takeChallenge(platform: ApplePlatform, state: unknown, binding: string | null) {
  if (typeof state !== "string" || !validRandomValue.test(state) ||
      (platform === "web" && (!binding || !validRandomValue.test(binding)))) throw new AppleAuthError("apple_expired");
  const db = await ensureAuthSchema();
  const bound = platform === "web" ? "browser_hash=?" : "session_hash IS ?";
  const value = platform === "web" ? await hashAppleValue(binding!) : binding;
  const challenge = await db.prepare(`DELETE FROM auth_apple_challenges
    WHERE state_hash=? AND platform=? AND expires_at>? AND ${bound}
    RETURNING nonce,purpose,destination,session_hash`)
    .bind(await hashAppleValue(state), platform, new Date().toISOString(), value).first<Challenge>();
  if (!challenge) throw new AppleAuthError("apple_expired");
  return {db, challenge};
}

let signingKeys: {expires: number; keys: AppleJWK[]} | undefined;
let keysRequest: Promise<AppleJWK[]> | undefined;
async function appleSigningKey(kid: string) {
  if (!signingKeys || signingKeys.expires < Date.now()) {
    keysRequest ??= (async () => {
      const response = await fetch(appleURL + "/auth/keys", {redirect: "error", signal: AbortSignal.timeout(4000)});
      if (!response.ok) throw new Error("Apple key list unavailable");
      const reply = await response.json() as {keys: AppleJWK[]};
      if (!Array.isArray(reply.keys)) throw new Error("Invalid Apple key list");
      signingKeys = {keys: reply.keys, expires: Date.now() + 300_000};
      return reply.keys;
    })().finally(() => { keysRequest = undefined; });
    return (await keysRequest).find(key => key.kid === kid);
  }
  return signingKeys.keys.find(key => key.kid === kid);
}

async function applePost(path: "/auth/token" | "/auth/revoke", id: string, fields: Record<string, string>) {
  const response = await fetch(appleURL + path, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(4500),
    body: new URLSearchParams({...fields, client_id: id, client_secret: await secret(id)}),
  });
  if (!response.ok) throw new Error("Apple rejected " + path);
  return response;
}

async function bindAppleIdentity(db: D1Database, challenge: Challenge, claims: Record<string, unknown>,
                                 id: string, refreshToken: string) {
  const subject = claims.sub;
  if (typeof subject !== "string" || subject.length < 1 || subject.length > 255) throw new AppleAuthError("apple_expired");
  const existing = await db.prepare("SELECT user_id FROM auth_apple_identities WHERE subject=?").bind(subject).first<{user_id: string}>();
  const encrypted = () => sealAppleRefreshToken(refreshToken, runtime.AUTH_APPLE_TOKEN_KEY!.trim(), subject, id);
  const now = new Date().toISOString();
  const authorizedAt = Number(claims.iat);
  if (challenge.purpose === "link") {
    const session = await db.prepare("SELECT user_id FROM auth_sessions WHERE token_hash=? AND expires_at>?")
      .bind(challenge.session_hash, now).first<{user_id: string}>();
    if (!session) throw new AppleAuthError("apple_session", 401);
    if (existing && existing.user_id !== session.user_id) throw new AppleAuthError("apple_in_use", 409);
    const current = await db.prepare("SELECT subject FROM auth_apple_identities WHERE user_id=?")
      .bind(session.user_id).first<{subject: string}>();
    if (current && current.subject !== subject) throw new AppleAuthError("apple_other_linked", 409);
    const result = await db.prepare(`INSERT INTO auth_apple_identities(subject,user_id,client_id,encrypted_refresh_token,authorized_at)
      SELECT ?,user_id,?,?,? FROM auth_sessions WHERE token_hash=? AND user_id=? AND expires_at>?
      ON CONFLICT(subject) DO UPDATE SET client_id=excluded.client_id,encrypted_refresh_token=excluded.encrypted_refresh_token,
        authorized_at=excluded.authorized_at
      WHERE auth_apple_identities.user_id=excluded.user_id`)
      .bind(subject, id, await encrypted(), authorizedAt, challenge.session_hash, session.user_id, now).run();
    if (!result.meta.changes) throw new AppleAuthError("apple_session", 401);
    return null;
  }
  if (existing) {
    await db.prepare("UPDATE auth_apple_identities SET client_id=?,encrypted_refresh_token=?,authorized_at=? WHERE subject=? AND user_id=? AND authorized_at<=?")
      .bind(id, await encrypted(), authorizedAt, subject, existing.user_id, authorizedAt).run();
    return createAppleSession(existing.user_id, subject);
  }
  if (challenge.purpose !== "register") throw new AppleAuthError("apple_not_linked", 409);
  const email = (claims.email_verified === true || claims.email_verified === "true") && normalizeEmail(claims.email);
  if (!email) throw new AppleAuthError("apple_email");
  const user = await userId(email);
  const hasAccount = () => db.prepare("SELECT id FROM users WHERE id=? UNION ALL SELECT user_id FROM auth_email_aliases WHERE email_id=?")
    .bind(user, user).first();
  if (await hasAccount()) throw new AppleAuthError("apple_existing", 409);
  const emailMask = maskEmail(email);
  try {
    await db.batch([
      db.prepare(`INSERT INTO users(id,display_name,created_at,updated_at)
        SELECT CASE WHEN EXISTS (SELECT 1 FROM auth_email_aliases WHERE email_id=?) THEN NULL ELSE ? END,?,?,?`)
        .bind(user, user, emailMask, now, now),
      db.prepare(`INSERT INTO auth_credentials(user_id,email_mask,email_address,email_verified_at,password_salt,password_hash,password_iterations,created_at,updated_at)
        VALUES(?,?,?,?,?,'',0,?,?)`).bind(user, emailMask, email, now, APPLE_CREDENTIAL_SCHEME, now, now),
      db.prepare("INSERT INTO auth_apple_identities(subject,user_id,client_id,encrypted_refresh_token,authorized_at) VALUES(?,?,?,?,?)")
        .bind(subject, user, id, await encrypted(), authorizedAt),
    ]);
  } catch (error) {
    if (await hasAccount()) throw new AppleAuthError("apple_existing", 409);
    throw error;
  }
  return createAppleSession(user, subject);
}

export async function finishAppleAuth(platform: ApplePlatform, state: unknown, binding: string | null, code: unknown, cancelled = false) {
  if (!appleConfigured(platform)) throw new AppleAuthError("apple_unavailable", 503);
  const {db, challenge} = await takeChallenge(platform, state, binding);
  if (cancelled) throw new AppleAuthError("apple_cancelled");
  if (typeof code !== "string" || !code || code.length > 2048) throw new AppleAuthError("apple_expired");
  const id = clientID(platform);
  const fields = {grant_type: "authorization_code", code, ...(platform === "web" && {redirect_uri: callbackURL()})};
  const reply = await (await applePost("/auth/token", id, fields)).json() as {id_token?: string; refresh_token?: string};
  if (typeof reply.id_token !== "string" || typeof reply.refresh_token !== "string" || !reply.refresh_token) throw new AppleAuthError("apple_expired");
  const claims = await verifyAppleToken(reply.id_token, [id], appleSigningKey);
  if (claims.nonce !== challenge.nonce) throw new AppleAuthError("apple_expired");
  const token = await bindAppleIdentity(db, challenge, claims, id, reply.refresh_token);
  if (!token && challenge.purpose !== "link") throw new AppleAuthError("apple_session", 401);
  return {token, destination: challenge.destination};
}

export async function appleLinkExists(user: string) {
  const db = await ensureAuthSchema();
  return Boolean(await db.prepare("SELECT 1 FROM auth_apple_identities WHERE user_id=? AND encrypted_refresh_token<>''").bind(user).first());
}

export async function revokeAppleForDeletion(user: string, createdAt: string | null) {
  const db = await ensureAuthSchema();
  const entry = await db.prepare(`SELECT a.* FROM auth_apple_identities a JOIN users u ON u.id=a.user_id
    WHERE u.id=? AND (? IS NULL OR u.created_at=?)`).bind(user, createdAt, createdAt).first<AppleIdentity>();
  if (!entry?.encrypted_refresh_token) return;
  if (!runtime.AUTH_APPLE_TEAM_ID || !runtime.AUTH_APPLE_KEY_ID || !runtime.AUTH_APPLE_PRIVATE_KEY || !runtime.AUTH_APPLE_TOKEN_KEY) {
    throw new AppleAuthError("apple_unavailable", 503);
  }
  await applePost("/auth/revoke", entry.client_id, {token_type_hint: "refresh_token",
    token: await openAppleRefreshToken(entry.encrypted_refresh_token, runtime.AUTH_APPLE_TOKEN_KEY.trim(), entry.subject, entry.client_id)});
}

export async function processAppleNotification(token: string) {
  const audiences = [appleNativeClientID, runtime.AUTH_APPLE_WEB_CLIENT_ID?.trim()].filter((id): id is string => Boolean(id));
  const claims = await verifyAppleToken(token, audiences, appleSigningKey, undefined, "notification");
  const event = typeof claims.events === "string" ? JSON.parse(claims.events) : claims.events;
  if (!event || typeof event !== "object") throw new Error("Invalid Apple notification");
  const {type, sub, event_time} = event as {type?: unknown; sub?: unknown; event_time?: unknown};
  if (type !== "consent-revoked" && type !== "account-deleted") return;
  const rawTime = typeof event_time === "string" || typeof event_time === "number" ? Number(event_time) : NaN;
  const eventTime = rawTime > 1e12 ? Math.floor(rawTime / 1000) : rawTime;
  if (typeof sub !== "string" || !sub || !Number.isFinite(eventTime) || eventTime <= 0 || eventTime > Date.now() / 1000 + 60) {
    throw new Error("Invalid Apple notification date or subject");
  }
  const db = await ensureAuthSchema();
  const identity = "SELECT user_id FROM auth_apple_identities WHERE subject=? AND authorized_at<=? AND encrypted_refresh_token<>''";
  await db.batch([
    db.prepare(`DELETE FROM auth_sessions WHERE user_id IN (${identity})`).bind(sub, eventTime),
    db.prepare(`UPDATE auth_apple_identities SET encrypted_refresh_token='' WHERE user_id IN (${identity})`).bind(sub, eventTime),
  ]);
}
