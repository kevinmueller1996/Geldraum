import "server-only";

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

function backendOrigin() {
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
  if ((mutating && !incomingOrigin) || (incomingOrigin && incomingOrigin !== incomingUrl.origin)) {
    return errorResponse("Unzulässige Anfrage.", 403);
  }

  try {
    const origin = backendOrigin();
    const target = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, origin);
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 600_000) return errorResponse("Die Anfrage ist zu groß.", 413);
    const headers = new Headers();
    for (const name of ["accept", "content-type", "cookie", "user-agent"] as const) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const adminToken = request.headers.get("x-njora-admin-token");
    if (adminToken && incomingUrl.pathname.startsWith("/api/admin/")) headers.set("x-njora-admin-token", adminToken);
    headers.set("origin", origin.origin);

    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
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
      if (value.startsWith("__Host-njora_session=") || value.startsWith("geldraum_session=")) {
        responseHeaders.append("set-cookie", cookie);
      }
    }
    responseHeaders.set("Cache-Control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    console.error("Cloudflare backend proxy failed", error instanceof Error ? error.message : "Unknown error");
    return errorResponse("Die Anwendung konnte den Datendienst gerade nicht erreichen.", 503);
  }
}
