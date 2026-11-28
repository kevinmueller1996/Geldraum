import { NextRequest, NextResponse } from "next/server";
import { AppleAuthError, appleBrowserCookie, finishAppleAuth } from "../../../../apple-auth";
import { authPublicOrigin } from "../../../../auth-email";
import { setSessionCookie } from "../../../../password-auth";
import { readBodyBytes } from "../../../../request-body";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../../../vercel/proxy-api";

export async function POST(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return new Response(null, {status: 415});
  let response: NextResponse;
  try {
    const fields = new URLSearchParams(new TextDecoder().decode(await readBodyBytes(request, 12_000)));
    const result = await finishAppleAuth("web", fields.get("state"), request.cookies.get(appleBrowserCookie)?.value ?? null,
      fields.get("code"), fields.has("error"));
    response = NextResponse.redirect(new URL(result.destination, authPublicOrigin()), 303);
    if (result.token) setSessionCookie(response, result.token, request);
  } catch (error) {
    const url = new URL("/login", authPublicOrigin());
    url.searchParams.set("apple", error instanceof AppleAuthError ? error.code : "apple_unavailable");
    response = NextResponse.redirect(url, 303);
  }
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set({name: appleBrowserCookie, value: "", path: "/", httpOnly: true, secure: true, sameSite: "none", maxAge: 0});
  return response;
}
