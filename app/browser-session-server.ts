import type { NextRequest } from "next/server";
import { isLocalHostname } from "./local-host";

// A browser binding cannot authenticate a request. Only the HttpOnly session can do that.
export async function browserSession(request: NextRequest) {
  const local = isLocalHostname(request.nextUrl.hostname);
  const token = request.cookies.get(local ? "geldraum_session" : "__Host-njora_session")?.value ?? (local ? "development" : "");
  if (!token) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("njora-browser-v1:" + token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function wrongSession(request: NextRequest) {
  const expected = request.headers.get("x-njora-browser-session");
  return expected !== null && expected !== await browserSession(request);
}
