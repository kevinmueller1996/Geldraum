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
    const reader = request.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const {value,done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) { await reader.cancel(); return new Response(null,{status:413}); }
      chunks.push(value);
    }
    body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk,offset); offset += chunk.length; }
  }
  const upstream = new URL("/api/chatgpt/"+action,backendOrigin());
  upstream.search = new URL(request.url).search;
  const res = await fetch(upstream,{headers,method:request.method,body,cache:"no-store",redirect:"manual",signal:AbortSignal.timeout(15000)});
  const out = new Headers({"cache-control":"no-store","referrer-policy":"no-referrer"});
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

