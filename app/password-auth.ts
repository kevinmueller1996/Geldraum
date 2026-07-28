import { env } from "cloudflare:workers";
import { compare as bcryptCompare, hash as bcryptHash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { isLocalHostname } from "./local-host";

const SESSION_COOKIE = "geldraum_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_COST = 11;
const PASSWORD_SCHEME = "bcrypt";
const DUMMY_PASSWORD_HASH = "$2b$11$rf0UBpb2Zjnp4JsyWYrA9.wy1IgG87VOy85GYQ19B1DTE8YzRRtKG";
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const LOGIN_MAX_FAILURES = 5;

const USERS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

const CREDENTIALS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS auth_credentials (
  user_id TEXT PRIMARY KEY NOT NULL,
  email_mask TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
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
  password_salt: string;
  password_hash: string;
  password_iterations: number;
};

type AttemptRow = {
  failed_count: number;
  window_started_at: string;
  locked_until: string | null;
};

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

export async function ensureAuthSchema() {
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
    SESSIONS_USER_INDEX_SQL,
    SESSIONS_EXPIRY_INDEX_SQL,
  ]) await db.prepare(statement).run();
  return db;
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

export function setSessionCookie(response: NextResponse, token: string, request: NextRequest) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: !isLocalHostname(new URL(request.url).hostname),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse, request: NextRequest) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: !isLocalHostname(new URL(request.url).hostname),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
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
  try {
    await db.batch([
      db.prepare(`INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`)
        .bind(id, emailMask, now, now),
      db.prepare(`INSERT INTO auth_credentials (user_id, email_mask, password_salt, password_hash, password_iterations, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, emailMask, PASSWORD_SCHEME, passwordHash, PASSWORD_COST, now, now),
      db.prepare("DELETE FROM auth_attempts WHERE email_hash = ?").bind(id),
    ]);
  } catch (error) {
    throw new PasswordAuthError("credentials", error);
  }
  try {
    return { token: await createSession(id), id, emailMask };
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

export async function verifyPasswordAccount(email: string, password: string) {
  const db = await ensureAuthSchema();
  const id = await userId(email);
  const attempt = await db.prepare("SELECT failed_count, window_started_at, locked_until FROM auth_attempts WHERE email_hash = ?")
    .bind(id).first<AttemptRow>();
  if (attempt?.locked_until && Date.parse(attempt.locked_until) > Date.now()) return { error: "locked" as const };

  const credential = await db.prepare(`SELECT user_id, email_mask, password_salt, password_hash, password_iterations
    FROM auth_credentials WHERE user_id = ?`).bind(id).first<CredentialRow>();
  const matches = await bcryptCompare(password, credential?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!credential || credential.password_salt !== PASSWORD_SCHEME || !matches) {
    await recordFailure(db, id, attempt);
    return { error: "invalid" as const };
  }

  await db.prepare("DELETE FROM auth_attempts WHERE email_hash = ?").bind(id).run();
  return { id, emailMask: credential.email_mask };
}

export async function loginPasswordAccount(email: string, password: string) {
  const result = await verifyPasswordAccount(email, password);
  if ("error" in result) return result;
  return { ...result, token: await createSession(result.id) };
}

export async function getSessionIdentity(request: NextRequest): Promise<SessionIdentity | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await ensureAuthSchema();
  const tokenHash = bytesToBase64Url(await sha256(token));
  const row = await db.prepare(`SELECT sessions.user_id, users.display_name, credentials.email_mask
    FROM auth_sessions AS sessions
    JOIN users ON users.id = sessions.user_id
    JOIN auth_credentials AS credentials ON credentials.user_id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`)
    .bind(tokenHash, new Date().toISOString()).first<{ user_id: string; display_name: string; email_mask: string }>();
  if (!row) return null;
  return { id: row.user_id, displayName: row.display_name, emailMask: row.email_mask, local: false };
}

export async function destroySession(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return;
  const db = await ensureAuthSchema();
  const tokenHash = bytesToBase64Url(await sha256(token));
  await db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export async function isRequestAuthenticated(request: NextRequest) {
  if (isLocalHostname(new URL(request.url).hostname)) return true;
  return Boolean(await getSessionIdentity(request));
}
