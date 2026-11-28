import "server-only";
import { formBodyLimit, readBodyBytes } from "../request-body";
import { expireMarker } from "../browser-session";

const DEFAULT_BACKEND_ORIGIN = "https://klarbudget-kevin-2026.alpher5.chatgpt.site";
const REQUIRED_D1_VARIABLES = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_D1_DATABASE_ID",
  "CLOUDFLARE_D1_API_TOKEN",
] as const;

export function needsCloudflareBackendProxy() {
  if (process.env.VERCEL !== "1") return false;
  const configured = REQUIRED_D1_VARIABLES.filter((name) => process.env[name]?.trim()).length;
  if (configured > 0 && configured < REQUIRED_D1_VARIABLES.length) {
    throw new Error("Incomplete Cloudflare D1 configuration: refusing to split production data across backends");
  }
  return configured === 0;
}

export function backendOrigin() {
  const configured = process.env.GELDRAUM_BACKEND_ORIGIN?.trim();
  const origin = new URL(configured || DEFAULT_BACKEND_ORIGIN);
  if (origin.protocol !== "https:") throw new Error("The backend origin must use HTTPS");
  return origin;
}

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function proxyApiRequest(request: Request) {
  const incomingUrl = new URL(request.url);
  const incomingOrigin = request.headers.get("origin");
  const mutating = request.method !== "GET" && request.method !== "HEAD";
  const appleCallback = request.method === "POST" && ["/api/auth/apple/callback", "/api/auth/apple/notifications"].includes(incomingUrl.pathname);
  if (!appleCallback && ((mutating && !incomingOrigin) || (incomingOrigin && incomingOrigin !== incomingUrl.origin))) {
    return errorResponse("Unzulässige Anfrage.", 403);
  }

  try {
    const origin = backendOrigin();
    const target = new URL(origin.origin);
    target.pathname = incomingUrl.pathname;
    target.search = incomingUrl.search;
    const bodyLimit = request.method === "PUT" && ["/api/account", "/api/account/business", "/api/sharing"].includes(incomingUrl.pathname) ? 600_000 : formBodyLimit;
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > bodyLimit) return errorResponse("Die Anfrage ist zu groß.", 413);
    const headers = new Headers();
    for (const name of ["accept", "content-type", "user-agent"] as const) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const adminRoute = incomingUrl.pathname.startsWith("/api/admin/");
    const sessionNames = adminRoute ? ["__Host-njora_admin_session", "njora_admin_session"] : ["__Host-njora_session", "geldraum_session"];
    if (incomingUrl.pathname.startsWith("/api/auth/apple/")) sessionNames.push("__Host-njora_apple");
    const sessionCookies = request.headers.get("cookie")?.split(";").map(cookie => cookie.trim())
      .filter(cookie => sessionNames.includes(cookie.split("=", 1)[0]));
    if (sessionCookies?.length) headers.set("cookie", sessionCookies.join("; "));
    // The export token is separate from the admin API token and is scoped to the backup endpoint.
    if (incomingUrl.pathname === "/api/admin/backup") {
      const backupToken = request.headers.get("x-njora-backup-token");
      if (backupToken) headers.set("x-njora-backup-token", backupToken);
    }
    const adminToken = request.headers.get("x-njora-admin-token");
    if (adminToken && incomingUrl.pathname.startsWith("/api/admin/")) headers.set("x-njora-admin-token", adminToken);
    headers.set("origin", origin.origin);

    let body;
    if (mutating) {
      try {
        body = await readBodyBytes(request, bodyLimit);
      } catch (error) {
        if (error instanceof RangeError) return errorResponse("Die Anfrage ist zu groß.", 413);
        throw error;
      }
    }
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const responseHeaders = new Headers(upstream.headers);
    const cookieHeaders = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
      ?? (upstream.headers.get("set-cookie") ? [upstream.headers.get("set-cookie")!] : []);
    for (const name of ["connection", "content-encoding", "content-length", "set-cookie", "transfer-encoding"]) {
      responseHeaders.delete(name);
    }
    for (const cookie of cookieHeaders) {
      const value = cookie.trimStart();
      if (sessionNames.includes(value.split("=", 1)[0])) {
        responseHeaders.append("set-cookie", cookie);
        if (!adminRoute) responseHeaders.append("set-cookie", expireMarker(request.url));
      }
    }
    responseHeaders.set("Cache-Control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    console.error("Cloudflare backend proxy failed", error instanceof Error ? error.message : "Unknown error");
    return errorResponse("Die Anwendung konnte den Datendienst gerade nicht erreichen.", 503);
  }
}
