import { NextRequest, NextResponse } from "next/server";
import { authPublicOrigin } from "../../../auth-email";
import { confirmEmailVerification, setSessionCookie, validPassword } from "../../../password-auth";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../../vercel/proxy-api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const destination = new URL("/email-bestaetigen", authPublicOrigin());
  if (token) destination.hash = `token=${encodeURIComponent(token)}`;
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function POST(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Unzulässige Anfrage." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { token?: unknown; password?: unknown } | null;
  if (!validPassword(body?.password)) {
    return NextResponse.json({ error: "Das Passwort muss zwischen 10 und 72 Zeichen lang sein." }, { status: 400 });
  }
  const result = typeof body?.token === "string" ? await confirmEmailVerification(body.token, body.password) : null;
  if (!result) return NextResponse.json({ error: "Der Link ist ungültig oder abgelaufen." }, { status: 400 });
  const response = NextResponse.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } });
  setSessionCookie(response, result.token, request);
  return response;
}
