import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "__Host-njora_admin_session";
const LOCAL_SESSION_COOKIE = "njora_admin_session";
const SESSION_SECONDS = 60 * 60 * 12;

function isLocalHostname(hostname: string) {
  const value = hostname.trim().toLowerCase();
  return value === "localhost" || value.endsWith(".localhost") || value === "127.0.0.1" || value === "::1" || value === "[::1]";
}

function cookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function equalSecret(left: string, right: string) {
  const [leftBytes, rightBytes] = await Promise.all([digest(left), digest(right)]);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < Math.min(leftBytes.length, rightBytes.length); index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

function sessionToken() {
  return (env as typeof env & { GELDRAUM_ADMIN_SESSION_TOKEN?: string }).GELDRAUM_ADMIN_SESSION_TOKEN;
}

async function sessionSignature(secret: string, payload: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function isAdminAuthenticated() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  const hostname = host.replace(/^\[/, "").replace(/\](:\d+)?$/, "").replace(/:\d+$/, "");
  const expected = sessionToken();
  const provided = cookieValue(requestHeaders.get("cookie"), isLocalHostname(hostname) ? LOCAL_SESSION_COOKIE : SESSION_COOKIE);
  if (!expected || !provided || !/^\d{10}\.[\da-f-]{36}\.[\da-f]{64}$/.test(provided)) return false;

  const [expires, nonce, signature] = provided.split(".");
  if (Number(expires) <= Math.floor(Date.now() / 1000)) return false;
  return equalSecret(signature, await sessionSignature(expected, expires + "." + nonce));
}

export async function setAdminSessionCookie(response: NextResponse, request: NextRequest) {
  const secret = sessionToken();
  if (!secret) throw new Error("Admin session token is unavailable");
  const local = isLocalHostname(new URL(request.url).hostname);
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = expires + "." + crypto.randomUUID();
  const signature = await sessionSignature(secret, payload);
  response.cookies.set({
    name: local ? LOCAL_SESSION_COOKIE : SESSION_COOKIE,
    value: payload + "." + signature,
    httpOnly: true,
    secure: !local,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export function clearAdminSessionCookie(response: NextResponse, request: NextRequest) {
  const local = isLocalHostname(new URL(request.url).hostname);
  response.cookies.set({ name: local ? LOCAL_SESSION_COOKIE : SESSION_COOKIE, value: "", httpOnly: true, secure: !local, sameSite: "lax", path: "/", maxAge: 0 });
}
