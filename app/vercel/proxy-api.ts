import "server-only";

const DEFAULT_BACKEND_ORIGIN = "https://klarbudget-kevin-2026.alpher5.chatgpt.site";
const REQUIRED_D1_VARIABLES = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_D1_DATABASE_ID",
  "CLOUDFLARE_D1_API_TOKEN",
] as const;

export function needsCloudflareBackendProxy() {
  return process.env.VERCEL === "1"
    && REQUIRED_D1_VARIABLES.some((name) => !process.env[name]?.trim());
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
  if (incomingOrigin && incomingOrigin !== incomingUrl.origin) {
    return errorResponse("Unzulässige Anfrage.", 403);
  }

  try {
    const origin = backendOrigin();
    const target = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, origin);
    const headers = new Headers(request.headers);
    for (const name of ["connection", "content-length", "host", "origin", "referer", "x-forwarded-host", "x-forwarded-proto"]) {
      headers.delete(name);
    }
    headers.set("origin", origin.origin);

    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
    });
    const responseHeaders = new Headers(upstream.headers);
    const cookieHeaders = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
      ?? (upstream.headers.get("set-cookie") ? [upstream.headers.get("set-cookie")!] : []);
    for (const name of ["connection", "content-encoding", "content-length", "set-cookie", "transfer-encoding"]) {
      responseHeaders.delete(name);
    }
    for (const cookie of cookieHeaders) {
      if (!cookie.trimStart().startsWith("__cf_")) responseHeaders.append("set-cookie", cookie);
    }
    responseHeaders.set("Cache-Control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    console.error("Cloudflare backend proxy failed", error instanceof Error ? error.message : "Unknown error");
    return errorResponse("Die Anwendung konnte den Datendienst gerade nicht erreichen.", 503);
  }
}
