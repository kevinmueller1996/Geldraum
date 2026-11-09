import { NextRequest, NextResponse } from "next/server";
import { isLocalHostname } from "../../../local-host";
import { authEmailConfigured, sendAuthEmail } from "../../../auth-email";
import { emailVerificationRequired, normalizeEmail, PasswordAuthError, registerPasswordAccount, requestEmailVerification, setSessionCookie, validPassword } from "../../../password-auth";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../../vercel/proxy-api";

export const dynamic = "force-dynamic";
const VERIFICATION_MESSAGE = "Wenn die Registrierung möglich ist, erhältst du eine E-Mail mit den nächsten Schritten.";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function validRequest(request: NextRequest) {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin
    && request.headers.get("content-type")?.toLowerCase().startsWith("application/json");
}

export async function POST(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  if (!validRequest(request)) return json({ error: "Unzulässige Anfrage." }, 403);
  try {
    const body = await request.json() as { email?: unknown; password?: unknown };
    const email = normalizeEmail(body.email);
    if (!email) return json({ error: "Bitte gib eine gültige E-Mail-Adresse ein." }, 400);
    const requiresVerification = !isLocalHostname(request.nextUrl.hostname) || emailVerificationRequired();
    const password = validPassword(body.password) ? body.password : undefined;
    if (!requiresVerification && !password) return json({ error: "Das Passwort muss zwischen 10 und 72 Zeichen lang sein." }, 400);
    if (requiresVerification && !authEmailConfigured()) {
      console.error("Password registration failed Email verification is required but email delivery is not configured");
      return json({ error: "Neue Konten können gerade nicht bestätigt werden. Bitte versuche es später erneut." }, 503);
    }
    const result = await registerPasswordAccount(email, password, requiresVerification);
    if ("error" in result) {
      if (requiresVerification) {
        const verification = await requestEmailVerification(email);
        if (verification && "email" in verification) await sendAuthEmail(verification.email, verification.token, "verify_email");
        return json({ verificationRequired: true, message: VERIFICATION_MESSAGE }, 202);
      }
      return json({ error: "Für diese E-Mail-Adresse besteht bereits ein Passwortkonto." }, 409);
    }
    if (result.verificationRequired) {
      await sendAuthEmail(result.email, result.verificationToken, "verify_email");
      return json({ verificationRequired: true, message: VERIFICATION_MESSAGE }, 202);
    }
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
