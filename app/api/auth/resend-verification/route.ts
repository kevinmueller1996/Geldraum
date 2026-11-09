import { NextRequest, NextResponse } from "next/server";
import { authEmailConfigured, sendAuthEmail } from "../../../auth-email";
import { normalizeEmail, requestEmailVerification } from "../../../password-auth";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../../vercel/proxy-api";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Unzulässige Anfrage." }, { status: 403 });
  }
  if (!authEmailConfigured()) {
    return NextResponse.json({ error: "Der E-Mail-Versand ist gerade nicht verfügbar." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  const email = normalizeEmail(body?.email);
  if (email) {
    const verification = await requestEmailVerification(email);
    if (verification && "email" in verification) await sendAuthEmail(verification.email, verification.token, "verify_email");
  }
  return NextResponse.json({ accepted: true, message: "Falls ein unbestätigtes Konto vorhanden ist, wurde eine E-Mail versendet." }, {
    status: 202,
    headers: { "Cache-Control": "no-store" },
  });
}
