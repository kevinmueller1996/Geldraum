import { NextRequest, NextResponse } from "next/server";
import { authEmailConfigured, sendAuthEmail } from "../../../auth-email";
import { normalizeEmail, requestPasswordReset } from "../../../password-auth";
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
    const reset = await requestPasswordReset(email);
    if (reset && "email" in reset) await sendAuthEmail(reset.email, reset.token, "password_reset");
  }
  return NextResponse.json({ accepted: true, message: "Falls ein Konto vorhanden ist, erhältst du eine E-Mail mit den nächsten Schritten." }, {
    status: 202,
    headers: { "Cache-Control": "no-store" },
  });
}
