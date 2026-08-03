import { env } from "cloudflare:workers";
import { compare as bcryptCompare, hash as bcryptHash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { isLocalHostname } from "./local-host";

const SESSION_COOKIE = "__Host-njora_session";
const LEGACY_SESSION_COOKIE = "geldraum_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_COST = 11;
const PASSWORD_SCHEME = "bcrypt";
const DUMMY_PASSWORD_HASH = "$2b$11$rf0UBpb2Zjnp4JsyWYrA9.wy1IgG87VOy85GYQ19B1DTE8YzRRtKG";
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const LOGIN_MAX_FAILURES = 5;
const VERIFY_EMAIL_SECONDS = 60 * 60 * 24;
const RESET_PASSWORD_SECONDS = 60 * 30;
const EMAIL_ACTION_LIMIT_PER_HOUR = 5;

const USERS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

const CREDENTIALS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS auth_credentials (
  user_id TEXT PRIMARY KEY NOT NULL,
  email_mask TEXT NOT NULL,
  email_address TEXT,
  email_verified_at TEXT,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`;

const ACTION_TOKENS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS auth_action_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'password_reset')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`;

const SESSIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`;

const ATTEMPTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS auth_attempts (
  email_hash TEXT PRIMARY KEY NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  locked_until TEXT
)`;

const SESSIONS_USER_INDEX_SQL = "CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions(user_id)";
const SESSIONS_EXPIRY_INDEX_SQL = "CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions(expires_at)";
const ACTION_TOKENS_USER_INDEX_SQL = "CREATE INDEX IF NOT EXISTS auth_action_tokens_user_purpose_idx ON auth_action_tokens(user_id, purpose)";
const ACTION_TOKENS_EXPIRY_INDEX_SQL = "CREATE INDEX IF NOT EXISTS auth_action_tokens_expires_at_idx ON auth_action_tokens(expires_at)";

export type SessionIdentity = {
  id: string;
  displayName: string;
  emailMask: string;
  local: false;
};

export class PasswordAuthError extends Error {
  constructor(public readonly code: "schema" | "hash" | "credentials" | "session", cause: unknown) {
    super(`Password authentication failed during ${code}`, { cause });
    this.name = "PasswordAuthError";
  }
}

type CredentialRow = {
  user_id: string;
  email_mask: string;
  email_address: string | null;
  email_verified_at: string | null;
  password_salt: string;
  password_hash: string;
  password_iterations: number;
};

type AttemptRow = {
  failed_count: number;
  window_started_at: string;
  locked_until: string | null;
};

type PasswordVerification =
  | { error: "locked" | "invalid" | "unverified" }
  | { id: string; emailMask: string };

type EmailPurpose = "verify_email" | "password_reset";

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 5 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 10 && value.length <= 72 && new TextEncoder().encode(value).byteLength <= 72;
}

export function maskEmail(email: string) {
  const [localPart = "", domain = ""] = email.split("@");
  const labels = domain.split(".");
  const domainName = labels.shift() ?? "";
  const suffix = labels.length ? `.${labels.join(".")}` : "";
  return `${localPart.slice(0, 1) || "•"}***@${domainName.slice(0, 1) || "•"}***${suffix}`;
}

export async function userId(email: string) {
  return Array.from(await sha256(email), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

let authSchemaPromise: Promise<D1Database> | null = null;

async function initializeAuthSchema() {
  const db = env.DB;
  if (!db) throw new Error("D1 binding DB is unavailable");
  // Production D1 can validate every statement in a batch before earlier DDL
  // has created the referenced tables. Run schema initialization in dependency
  // order so a fresh deployment is immediately ready for registration.
  for (const statement of [
    USERS_TABLE_SQL,
    CREDENTIALS_TABLE_SQL,
    SESSIONS_TABLE_SQL,
    ATTEMPTS_TABLE_SQL,
    ACTION_TOKENS_TABLE_SQL,
    SESSIONS_USER_INDEX_SQL,
    SESSIONS_EXPIRY_INDEX_SQL,
    ACTION_TOKENS_USER_INDEX_SQL,
    ACTION_TOKENS_EXPIRY_INDEX_SQL,
  ]) await db.prepare(statement).run();

  return db;
}

export async function ensureAuthSchema() {
  if (!authSchemaPromise) authSchemaPromise = initializeAuthSchema().catch((error) => {
    authSchemaPromise = null;
    throw error;
  });
  return authSchemaPromise;
}

export function emailVerificationRequired() {
  const runtimeEnv = env as typeof env & { AUTH_REQUIRE_EMAIL_VERIFICATION?: string };
  if (runtimeEnv.AUTH_REQUIRE_EMAIL_VERIFICATION === "0") return false;
  return runtimeEnv.AUTH_REQUIRE_EMAIL_VERIFICATION === "1" || process.env.NODE_ENV === "production";
}

async function createSession(userIdValue: string) {
  const db = await ensureAuthSchema();
  const rawToken = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = bytesToBase64Url(await sha256(rawToken));
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_SECONDS * 1_000);
  await db.batch([
    db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(now.toISOString()),
    db.prepare("INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(tokenHash, userIdValue, now.toISOString(), expires.toISOString()),
  ]);
  return rawToken;
}

async function createActionToken(userIdValue: string, purpose: EmailPurpose) {
  const db = await ensureAuthSchema();
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1_000).toISOString();
  const recent = await db.prepare(`SELECT COUNT(*) AS count FROM auth_action_tokens
    WHERE user_id = ? AND purpose = ? AND created_at > ?`)
    .bind(userIdValue, purpose, hourAgo).first<{ count: number }>();
  if ((recent?.count ?? 0) >= EMAIL_ACTION_LIMIT_PER_HOUR) return { error: "rate_limited" as const };

  const rawToken = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = bytesToBase64Url(await sha256(rawToken));
  const ttl = purpose === "verify_email" ? VERIFY_EMAIL_SECONDS : RESET_PASSWORD_SECONDS;
  await db.batch([
    db.prepare("DELETE FROM auth_action_tokens WHERE expires_at <= ? OR (consumed_at IS NOT NULL AND created_at <= ?)")
      .bind(now.toISOString(), hourAgo),
    db.prepare(`UPDATE auth_action_tokens SET consumed_at = ?
      WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL`)
      .bind(now.toISOString(), userIdValue, purpose),
    db.prepare(`INSERT INTO auth_action_tokens (token_hash, user_id, purpose, created_at, expires_at, consumed_at)
      VALUES (?, ?, ?, ?, ?, NULL)`)
      .bind(tokenHash, userIdValue, purpose, now.toISOString(), new Date(now.getTime() + ttl * 1_000).toISOString()),
  ]);
  return { token: rawToken };
}

async function findActionToken(rawToken: string, purpose: EmailPurpose) {
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(rawToken)) return null;
  const db = await ensureAuthSchema();
  const tokenHash = bytesToBase64Url(await sha256(rawToken));
  const now = new Date().toISOString();
  const row = await db.prepare(`SELECT user_id FROM auth_action_tokens
    WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?`)
    .bind(tokenHash, purpose, now).first<{ user_id: string }>();
  if (!row) return null;
  return { db, userId: row.user_id, now, tokenHash };
}

export function setSessionCookie(response: NextResponse, token: string, request: NextRequest) {
  const local = isLocalHostname(new URL(request.url).hostname);
  response.cookies.set({
    name: local ? LEGACY_SESSION_COOKIE : SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: !local,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse, request: NextRequest) {
  for (const name of [SESSION_COOKIE, LEGACY_SESSION_COOKIE]) {
    response.cookies.set({
      name,
      value: "",
      httpOnly: true,
      secure: !isLocalHostname(new URL(request.url).hostname),
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}

export async function registerPasswordAccount(email: string, password: string) {
  let db: D1Database;
  try {
    db = await ensureAuthSchema();
  } catch (error) {
    throw new PasswordAuthError("schema", error);
  }
  const id = await userId(email);
  const existing = await db.prepare("SELECT user_id FROM auth_credentials WHERE user_id = ?").bind(id).first<{ user_id: string }>();
  if (existing) return { error: "exists" as const };

  let passwordHash: string;
  try {
    passwordHash = await bcryptHash(password, PASSWORD_COST);
  } catch (error) {
    throw new PasswordAuthError("hash", error);
  }
  const emailMask = maskEmail(email);
  const now = new Date().toISOString();
  const requiresVerification = emailVerificationRequired();
  try {
    await db.batch([
      db.prepare(`INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`)
        .bind(id, emailMask, now, now),
      db.prepare(`INSERT INTO auth_credentials (user_id, email_mask, email_address, email_verified_at, password_salt, password_hash, password_iterations, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, emailMask, email, requiresVerification ? null : now, PASSWORD_SCHEME, passwordHash, PASSWORD_COST, now, now),
      db.prepare("DELETE FROM auth_attempts WHERE email_hash = ?").bind(id),
    ]);
  } catch (error) {
    throw new PasswordAuthError("credentials", error);
  }
  if (requiresVerification) {
    const action = await createActionToken(id, "verify_email");
    if ("error" in action) throw new PasswordAuthError("session", new Error("Verification rate limit reached"));
    return { verificationRequired: true as const, verificationToken: action.token, id, emailMask, email };
  }
  try {
    return { verificationRequired: false as const, token: await createSession(id), id, emailMask };
  } catch (error) {
    throw new PasswordAuthError("session", error);
  }
}

async function recordFailure(db: D1Database, emailHash: string, attempt: AttemptRow | null) {
  const now = Date.now();
  const windowStart = attempt ? Date.parse(attempt.window_started_at) : 0;
  const inWindow = Number.isFinite(windowStart) && now - windowStart <= LOGIN_WINDOW_MS;
  const failedCount = inWindow ? attempt!.failed_count + 1 : 1;
  const windowStartedAt = new Date(inWindow ? windowStart : now).toISOString();
  const lockedUntil = failedCount >= LOGIN_MAX_FAILURES ? new Date(now + LOGIN_WINDOW_MS).toISOString() : null;
  await db.prepare(`INSERT INTO auth_attempts (email_hash, failed_count, window_started_at, locked_until) VALUES (?, ?, ?, ?)
    ON CONFLICT(email_hash) DO UPDATE SET failed_count = excluded.failed_count, window_started_at = excluded.window_started_at, locked_until = excluded.locked_until`)
    .bind(emailHash, failedCount, windowStartedAt, lockedUntil).run();
}

export async function verifyPasswordAccount(email: string, password: string): Promise<PasswordVerification> {
  const db = await ensureAuthSchema();
  const id = await userId(email);
  const attempt = await db.prepare("SELECT failed_count, window_started_at, locked_until FROM auth_attempts WHERE email_hash = ?")
    .bind(id).first<AttemptRow>();
  if (attempt?.locked_until && Date.parse(attempt.locked_until) > Date.now()) return { error: "locked" as const };

  const credential = await db.prepare(`SELECT user_id, email_mask, email_address, email_verified_at, password_salt, password_hash, password_iterations
    FROM auth_credentials WHERE user_id = ?`).bind(id).first<CredentialRow>();
  const matches = await bcryptCompare(password, credential?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!credential || credential.password_salt !== PASSWORD_SCHEME || !matches) {
    await recordFailure(db, id, attempt);
    return { error: "invalid" as const };
  }

  await db.prepare("DELETE FROM auth_attempts WHERE email_hash = ?").bind(id).run();
  if (!credential.email_address) {
    await db.prepare("UPDATE auth_credentials SET email_address = ?, updated_at = ? WHERE user_id = ?")
      .bind(email, new Date().toISOString(), id).run();
  }
  if (emailVerificationRequired() && !credential.email_verified_at) return { error: "unverified" as const };
  return { id, emailMask: credential.email_mask };
}

export async function requestEmailVerification(email: string) {
  const db = await ensureAuthSchema();
  const id = await userId(email);
  const credential = await db.prepare("SELECT email_verified_at FROM auth_credentials WHERE user_id = ?")
    .bind(id).first<{ email_verified_at: string | null }>();
  if (!credential || credential.email_verified_at) return null;
  await db.prepare("UPDATE auth_credentials SET email_address = ?, updated_at = ? WHERE user_id = ?")
    .bind(email, new Date().toISOString(), id).run();
  const action = await createActionToken(id, "verify_email");
  if ("error" in action) return action;
  return { email, token: action.token };
}

export async function confirmEmailVerification(rawToken: string) {
  const action = await findActionToken(rawToken, "verify_email");
  if (!action) return null;
  const results = await action.db.batch([
    action.db.prepare(`UPDATE auth_credentials SET email_verified_at = ?, updated_at = ?
      WHERE user_id = ? AND EXISTS (SELECT 1 FROM auth_action_tokens
        WHERE token_hash = ? AND purpose = 'verify_email' AND consumed_at IS NULL AND expires_at > ?)`)
      .bind(action.now, action.now, action.userId, action.tokenHash, action.now),
    action.db.prepare(`UPDATE auth_action_tokens SET consumed_at = ?
      WHERE user_id = ? AND purpose = 'verify_email' AND token_hash != ? AND consumed_at IS NULL
        AND EXISTS (SELECT 1 FROM auth_action_tokens WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?)`)
      .bind(action.now, action.userId, action.tokenHash, action.tokenHash, action.now),
    action.db.prepare(`UPDATE auth_action_tokens SET consumed_at = ?
      WHERE token_hash = ? AND purpose = 'verify_email' AND consumed_at IS NULL AND expires_at > ?`)
      .bind(action.now, action.tokenHash, action.now),
  ]);
  if (!results[0].meta.changes) return null;
  return { token: await createSession(action.userId) };
}

export async function requestPasswordReset(email: string) {
  const db = await ensureAuthSchema();
  const id = await userId(email);
  const credential = await db.prepare("SELECT user_id FROM auth_credentials WHERE user_id = ?")
    .bind(id).first<{ user_id: string }>();
  if (!credential) return null;
  await db.prepare("UPDATE auth_credentials SET email_address = ?, updated_at = ? WHERE user_id = ?")
    .bind(email, new Date().toISOString(), id).run();
  const action = await createActionToken(id, "password_reset");
  if ("error" in action) return action;
  return { email, token: action.token };
}

export async function resetPasswordWithToken(rawToken: string, password: string) {
  const action = await findActionToken(rawToken, "password_reset");
  if (!action) return null;
  const passwordHash = await bcryptHash(password, PASSWORD_COST);
  const validTokenSql = `EXISTS (SELECT 1 FROM auth_action_tokens
    WHERE token_hash = ? AND purpose = 'password_reset' AND consumed_at IS NULL AND expires_at > ?)`;
  const results = await action.db.batch([
    action.db.prepare(`UPDATE auth_credentials SET password_hash = ?, password_salt = ?, password_iterations = ?,
      email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE user_id = ? AND ${validTokenSql}`)
      .bind(passwordHash, PASSWORD_SCHEME, PASSWORD_COST, action.now, action.now, action.userId, action.tokenHash, action.now),
    action.db.prepare(`DELETE FROM auth_sessions WHERE user_id = ? AND ${validTokenSql}`)
      .bind(action.userId, action.tokenHash, action.now),
    action.db.prepare(`DELETE FROM auth_attempts WHERE email_hash = ? AND ${validTokenSql}`)
      .bind(action.userId, action.tokenHash, action.now),
    action.db.prepare(`UPDATE auth_action_tokens SET consumed_at = ?
      WHERE user_id = ? AND token_hash != ? AND consumed_at IS NULL AND ${validTokenSql}`)
      .bind(action.now, action.userId, action.tokenHash, action.tokenHash, action.now),
    action.db.prepare(`UPDATE auth_action_tokens SET consumed_at = ?
      WHERE token_hash = ? AND purpose = 'password_reset' AND consumed_at IS NULL AND expires_at > ?`)
      .bind(action.now, action.tokenHash, action.now),
  ]);
  if (!results[0].meta.changes) return null;
  return { token: await createSession(action.userId) };
}

export async function loginPasswordAccount(email: string, password: string) {
  const result = await verifyPasswordAccount(email, password);
  if ("error" in result) return result;
  return { id: result.id, emailMask: result.emailMask, token: await createSession(result.id) };
}

export async function getSessionIdentity(request: NextRequest): Promise<SessionIdentity | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value ?? request.cookies.get(LEGACY_SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await ensureAuthSchema();
  const tokenHash = bytesToBase64Url(await sha256(token));
  const row = await db.prepare(`SELECT sessions.user_id, users.display_name, credentials.email_mask
    FROM auth_sessions AS sessions
    JOIN users ON users.id = sessions.user_id
    JOIN auth_credentials AS credentials ON credentials.user_id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
      AND (? = 0 OR credentials.email_verified_at IS NOT NULL)`)
    .bind(tokenHash, new Date().toISOString(), emailVerificationRequired() ? 1 : 0)
    .first<{ user_id: string; display_name: string; email_mask: string }>();
  if (!row) return null;
  return { id: row.user_id, displayName: row.display_name, emailMask: row.email_mask, local: false };
}

export async function destroySession(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value ?? request.cookies.get(LEGACY_SESSION_COOKIE)?.value;
  if (!token) return;
  const db = await ensureAuthSchema();
  const tokenHash = bytesToBase64Url(await sha256(token));
  await db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export async function isRequestAuthenticated(request: NextRequest) {
  if (isLocalHostname(new URL(request.url).hostname)) return true;
  return Boolean(await getSessionIdentity(request));
}
