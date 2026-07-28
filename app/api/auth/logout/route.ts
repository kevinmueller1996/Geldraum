import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, destroySession } from "../../../password-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Unzulässige Anfrage." }, { status: 403 });
  await destroySession(request);
  const response = NextResponse.json({ signedOut: true }, { headers: { "Cache-Control": "no-store" } });
  clearSessionCookie(response, request);
  return response;
}
