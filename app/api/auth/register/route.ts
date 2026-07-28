import { NextRequest, NextResponse } from "next/server";
import { normalizeEmail, PasswordAuthError, registerPasswordAccount, setSessionCookie, validPassword } from "../../../password-auth";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function validRequest(request: NextRequest) {
  const origin = request.headers.get("origin");
  return (!origin || origin === new URL(request.url).origin)
    && request.headers.get("content-type")?.toLowerCase().startsWith("application/json");
}

export async function POST(request: NextRequest) {
  if (!validRequest(request)) return json({ error: "Unzulässige Anfrage." }, 403);
  try {
    const body = await request.json() as { email?: unknown; password?: unknown };
    const email = normalizeEmail(body.email);
    if (!email) return json({ error: "Bitte gib eine gültige E-Mail-Adresse ein." }, 400);
    if (!validPassword(body.password)) return json({ error: "Das Passwort muss zwischen 10 und 72 Zeichen lang sein." }, 400);
    const result = await registerPasswordAccount(email, body.password);
    if ("error" in result) return json({ error: "Für diese E-Mail-Adresse besteht bereits ein Passwortkonto." }, 409);
    const response = json({ authenticated: true, user: { displayName: result.emailMask, email: result.emailMask } }, 201);
    setSessionCookie(response, result.token, request);
    return response;
  } catch (error) {
    console.error("Password registration failed", error instanceof Error ? error.message : "Unknown error");
    return json({
      error: "Das Konto konnte gerade nicht erstellt werden.",
      code: error instanceof PasswordAuthError ? error.code : "unknown",
    }, 503);
  }
}
