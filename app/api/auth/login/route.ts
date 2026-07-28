import { NextRequest, NextResponse } from "next/server";
import { loginPasswordAccount, normalizeEmail, setSessionCookie, validPassword } from "../../../password-auth";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "Unzulässige Anfrage." }, 403);
  }
  try {
    const body = await request.json() as { email?: unknown; password?: unknown };
    const email = normalizeEmail(body.email);
    if (!email || !validPassword(body.password)) return json({ error: "E-Mail-Adresse oder Passwort ist nicht korrekt." }, 401);
    const result = await loginPasswordAccount(email, body.password);
    if ("error" in result) {
      if (result.error === "locked") return json({ error: "Zu viele Anmeldeversuche. Bitte versuche es in 15 Minuten erneut." }, 429);
      return json({ error: "E-Mail-Adresse oder Passwort ist nicht korrekt." }, 401);
    }
    const response = json({ authenticated: true, user: { displayName: result.emailMask, email: result.emailMask } });
    setSessionCookie(response, result.token, request);
    return response;
  } catch (error) {
    console.error("Password login failed", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "Die Anmeldung ist gerade nicht verfügbar." }, 503);
  }
}
