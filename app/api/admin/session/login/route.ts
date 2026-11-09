import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { equalSecret, setAdminSessionCookie } from "../../../../admin/admin-auth";
import { normalizeEmail, validPassword, verifyPasswordAccount } from "../../../../password-auth";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "Unzulässige Anfrage." }, 403);
  try {
    const body = await request.json() as { email?: unknown; password?: unknown };
    const email = normalizeEmail(body.email);
    if (!email || !validPassword(body.password)) return json({ error: "E-Mail-Adresse oder Passwort ist nicht korrekt." }, 401);
    const expectedUserId = (env as typeof env & { GELDRAUM_ADMIN_USER_ID?: string }).GELDRAUM_ADMIN_USER_ID;
    if (!expectedUserId) throw new Error("Admin user is unavailable");
    const result = await verifyPasswordAccount(email, body.password);
    if ("error" in result) return json({ error: "E-Mail-Adresse oder Passwort ist nicht korrekt." }, result.error === "locked" ? 429 : 401);
    if (!(await equalSecret(result.id, expectedUserId))) return json({ error: "E-Mail-Adresse oder Passwort ist nicht korrekt." }, 401);
    const response = json({ authenticated: true });
    await setAdminSessionCookie(response, request);
    return response;
  } catch (error) {
    console.error("Admin login failed", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "Die Admin-Anmeldung ist gerade nicht verfügbar." }, 503);
  }
}
