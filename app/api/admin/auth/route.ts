import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { normalizeEmail, validPassword, verifyPasswordAccount } from "../../../password-auth";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../../vercel/proxy-api";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" },
  });
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function equalSecret(left: string, right: string) {
  const [leftBytes, rightBytes] = await Promise.all([digest(left), digest(right)]);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < Math.min(leftBytes.length, rightBytes.length); index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

export async function POST(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  const runtimeEnv = env as typeof env & { GELDRAUM_ADMIN_TOKEN?: string; GELDRAUM_ADMIN_USER_ID?: string };
  const expectedToken = runtimeEnv.GELDRAUM_ADMIN_TOKEN;
  const expectedUserId = runtimeEnv.GELDRAUM_ADMIN_USER_ID;
  const providedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expectedToken || !expectedUserId || !providedToken || !(await equalSecret(providedToken, expectedToken))) {
    return json({ error: "Nicht autorisiert." }, 401);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "JSON erwartet." }, 415);
  }

  try {
    const body = await request.json() as { email?: unknown; password?: unknown };
    const email = normalizeEmail(body.email);
    if (!email || !validPassword(body.password)) return json({ authenticated: false }, 401);
    const result = await verifyPasswordAccount(email, body.password);
    if ("error" in result) return json({ authenticated: false, locked: result.error === "locked" }, result.error === "locked" ? 429 : 401);
    if (!(await equalSecret(result.id, expectedUserId))) return json({ authenticated: false }, 401);
    return json({ authenticated: true });
  } catch (error) {
    console.error("Admin authentication failed", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "Die Admin-Anmeldung ist gerade nicht verfügbar." }, 503);
  }
}
