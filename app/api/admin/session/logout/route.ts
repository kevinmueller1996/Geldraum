import { NextRequest, NextResponse } from "next/server";
import { clearAdminSessionCookie } from "../../../../admin/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Unzulässige Anfrage." }, { status: 403 });
  const response = NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store, private" } });
  clearAdminSessionCookie(response, request);
  return response;
}
