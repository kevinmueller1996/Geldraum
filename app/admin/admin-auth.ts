import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isLocalHostname } from "../local-host";
import { ensureAuthSchema } from "../password-auth";

const SESSION_COOKIE = "__Host-njora_admin_session";
const LOCAL_SESSION_COOKIE = "njora_admin_session";
const SESSION_SECONDS = 60 * 60 * 12;

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function equalSecret(left: string, right: string) {
  const [leftBytes, rightBytes] = await Promise.all([digest(left), digest(right)]);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < Math.min(leftBytes.length, rightBytes.length); index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

// A distinct namespace keeps user sessions and operator sessions independent.
// Rotating the operator secret also invalidates all previously issued admin cookies.
async function sessionHash(token: string) {
  if (!env.GELDRAUM_ADMIN_SESSION_TOKEN) throw new Error("Admin session token is unavailable");
  const hash = await digest("njora-admin:" + env.GELDRAUM_ADMIN_SESSION_TOKEN + ":" + token);
  return Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
}

export function adminCookie(requestHeaders: Headers) {
  const host = requestHeaders.get("host") ?? "";
  const local = isLocalHostname(host.replace(/:\d+$/, ""));
  const name = local ? LOCAL_SESSION_COOKIE : SESSION_COOKIE;
  return requestHeaders.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(name + "="));
}

export async function isAdminAuthenticated() {
  const token = adminCookie(await headers())?.split("=")[1];
  const user = env.GELDRAUM_ADMIN_USER_ID;
  if (!token || !/^[\da-f-]{36}$/.test(token) || typeof user !== "string") return false;
  const db = await ensureAuthSchema();
  return Boolean(await db.prepare("SELECT 1 FROM auth_sessions WHERE token_hash=? AND user_id=? AND expires_at>?")
    .bind(await sessionHash(token), user, new Date().toISOString()).first());
}

export async function setAdminSessionCookie(response: NextResponse, request: NextRequest, user: string, verifiedHash: string) {
  const db = await ensureAuthSchema();
  const token = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_SECONDS * 1000);
  const [, issued] = await db.batch([
    db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(now.toISOString()),
    db.prepare(`INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at)
      SELECT ?,user_id,?,? FROM auth_credentials WHERE user_id=? AND password_hash=?`)
      .bind(await sessionHash(token), now.toISOString(), expires.toISOString(), user, verifiedHash)
  ]);
  if (!issued.meta.changes) throw new Error("Credentials changed during login");
  const local = isLocalHostname(request.nextUrl.hostname);
  response.cookies.set({
    name: local ? LOCAL_SESSION_COOKIE : SESSION_COOKIE, value: token, httpOnly: true,
    secure: !local, sameSite: "strict", path: "/", maxAge: SESSION_SECONDS
  });
}

export async function clearAdminSessionCookie(response: NextResponse, request: NextRequest) {
  const local = isLocalHostname(request.nextUrl.hostname);
  const name = local ? LOCAL_SESSION_COOKIE : SESSION_COOKIE;
  const token = request.cookies.get(name)?.value;
  if (token && /^[\da-f-]{36}$/.test(token)) {
    const db = await ensureAuthSchema();
    await db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").bind(await sessionHash(token)).run();
  }
  response.cookies.set({ name, value: "", httpOnly: true, secure: !local, sameSite: "strict", path: "/", maxAge: 0 });
}
