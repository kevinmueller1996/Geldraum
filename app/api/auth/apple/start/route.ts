import { NextRequest, NextResponse } from "next/server";
import { AppleAuthError, appleBrowserCookie, applePurpose, beginAppleAuth } from "../../../../apple-auth";
import { authPublicOrigin } from "../../../../auth-email";
import { getSessionIdentity, sessionTokenHash } from "../../../../password-auth";
import { readBodyBytes } from "../../../../request-body";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../../../vercel/proxy-api";

export async function POST(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  if (request.headers.get("origin") !== request.nextUrl.origin ||
      !request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return new Response(null, {status: 403});
  try {
    const fields = new URLSearchParams(new TextDecoder().decode(await readBodyBytes(request, 4096)));
    const purpose = applePurpose(fields.get("purpose"));
    if (purpose === "link" && !await getSessionIdentity(request)) throw new AppleAuthError("apple_session", 401);
    if (purpose !== "link" && await getSessionIdentity(request)) return NextResponse.redirect(new URL("/", authPublicOrigin()), 303);
    const result = await beginAppleAuth("web", purpose, purpose === "link" ? await sessionTokenHash(request) : null, fields.get("continue"));
    const response = NextResponse.redirect(result.url, 303);
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set({name: appleBrowserCookie, value: result.browser!, path: "/", httpOnly: true, secure: true, sameSite: "none", maxAge: result.expiresIn});
    return response;
  } catch (error) {
    const url = new URL("/login", authPublicOrigin());
    url.searchParams.set("apple", error instanceof AppleAuthError ? error.code : "apple_unavailable");
    return NextResponse.redirect(url, 303);
  }
}
