import { NextRequest, NextResponse } from "next/server";
import { AppleAuthError, appleConfigured, appleErrors, appleLinkExists, applePurpose, beginAppleAuth, finishAppleAuth } from "../../../apple-auth";
import { getSessionIdentity, sessionTokenHash, setSessionCookie } from "../../../password-auth";
import { readFormObject } from "../../../request-body";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../../vercel/proxy-api";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers: {"Cache-Control": "private, no-store"}});

export async function GET(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  const web = appleConfigured("web"), native = appleConfigured("native");
  if (!web && !native) return json({web, native, linked: false});
  try {
    const identity = await getSessionIdentity(request);
    return json({web, native, linked: identity ? await appleLinkExists(identity.id) : false});
  } catch { return json({web: false, native: false, linked: false}, 503); }
}

export async function POST(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  if (request.headers.get("origin") !== request.nextUrl.origin ||
      !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({error: "Unzulässige Anfrage."}, 403);
  try {
    const body = await readFormObject(request);
    if (body?.action === "begin") {
      const purpose = applePurpose(body.purpose);
      if (purpose === "link" && !await getSessionIdentity(request)) throw new AppleAuthError("apple_session", 401);
      const challenge = await beginAppleAuth("native", purpose, purpose === "link" ? await sessionTokenHash(request) : null, "/");
      return json({state: challenge.state, nonce: challenge.nonce, expiresIn: challenge.expiresIn});
    }
    if (body?.action !== "finish") return json({error: "Unbekannte Anfrage."}, 400);
    const result = await finishAppleAuth("native", body.state, await sessionTokenHash(request), body.code);
    const response = json({authenticated: Boolean(result.token), linked: true});
    if (result.token) setSessionCookie(response, result.token, request);
    return response;
  } catch (error) {
    const code = error instanceof AppleAuthError ? error.code : "apple_unavailable";
    return json({code, error: appleErrors[code]}, error instanceof AppleAuthError ? error.status : 503);
  }
}
