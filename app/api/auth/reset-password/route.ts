import { NextRequest, NextResponse } from "next/server";
import { resetPasswordWithToken, setSessionCookie, validPassword } from "../../../password-auth";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../../vercel/proxy-api";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Unzulässige Anfrage." }, { status: 403 });
  }
  const body = await request.json() as { token?: unknown; password?: unknown };
  if (typeof body.token !== "string" || !validPassword(body.password)) {
    return NextResponse.json({ error: "Der Link oder das neue Passwort ist ungültig." }, { status: 400 });
  }
  const result = await resetPasswordWithToken(body.token, body.password);
  if (!result) return NextResponse.json({ error: "Der Link ist ungültig oder abgelaufen." }, { status: 400 });
  const response = NextResponse.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } });
  setSessionCookie(response, result.token, request);
  return response;
}
