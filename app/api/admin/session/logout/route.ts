import { needsCloudflareBackendProxy, proxyApiRequest } from "../../../../vercel/proxy-api";
import { NextRequest, NextResponse } from "next/server";
import { clearAdminSessionCookie } from "../../../../admin/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin) return NextResponse.json({ error: "Unzulässige Anfrage." }, { status: 403 });
  const response = NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store, private" } });
  await clearAdminSessionCookie(response, request);
  return response;
}
