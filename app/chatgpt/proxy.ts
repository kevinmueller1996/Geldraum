import { readBodyBytes } from "../request-body";
import { issuer } from "./config";
import { backendOrigin } from "../vercel/proxy-api";

export async function proxyPlugin(request: Request, action: string) {
  const browser = ["authorize","manage","confirm"].includes(action);
  const origin = request.headers.get("origin");
  if (browser && request.method === "POST" && origin !== issuer) return new Response(null,{status:403});
  const headers = new Headers();
  for (const name of ["content-type","accept","mcp-protocol-version","mcp-session-id","mcp-method","mcp-name","origin"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name,value);
  }
  if (action === "mcp" && request.headers.has("authorization")) headers.set("authorization",request.headers.get("authorization")!);
  if (browser) {
    const session = request.headers.get("cookie")?.split(";").map(v=>v.trim()).find(v=>v.startsWith("__Host-njora_session="));
    if (session) headers.set("cookie",session);
  }
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (request.body) {
    try {
      body = await readBodyBytes(request, 65536);
    } catch (error) {
      if (error instanceof RangeError) return new Response(null, {status:413});
      throw error;
    }
  }
  const upstream = new URL("/api/chatgpt/"+action,backendOrigin());
  upstream.search = new URL(request.url).search;
  const res = await fetch(upstream,{headers,method:request.method,body,cache:"no-store",redirect:"manual",signal:AbortSignal.timeout(15000)});
  const formPage = browser && res.status >= 200 && res.status < 300 && res.headers.get("content-type")?.startsWith("text/html");
  const out = new Headers({"cache-control":"no-store","referrer-policy":formPage ? "same-origin" : "no-referrer"});
  for (const name of ["content-type","www-authenticate","location","allow","content-security-policy","mcp-protocol-version","mcp-session-id","x-frame-options"]) {
    const value = res.headers.get(name);
    if (value) out.set(name,value);
  }
  // The hosted backend can attach its site-wide CSP after rendering the consent page.
  // On our public issuer, only the registered ChatGPT callback may receive this form redirect.
  if (action === "authorize") {
    out.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self' https://chatgpt.com/connector_platform_oauth_redirect; frame-ancestors 'none'; base-uri 'none'");
  }
  return new Response(res.body,{status:res.status,headers:out});
}

