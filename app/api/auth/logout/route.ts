import { wrongSession } from "../../../browser-session-server";
import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, destroySession } from "../../../password-auth";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../../vercel/proxy-api";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (await wrongSession(request)) return NextResponse.json({error:"Die Sitzung hat gewechselt."}, {status:412});
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin) return NextResponse.json({ error: "Unzulässige Anfrage." }, { status: 403 });
  await destroySession(request);
  const response = NextResponse.json({ signedOut: true }, { headers: { "Cache-Control": "no-store" } });
  clearSessionCookie(response, request);
  return response;
}
