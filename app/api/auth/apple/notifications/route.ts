import { NextRequest } from "next/server";
import { processAppleNotification } from "../../../../apple-auth";
import { readBodyBytes } from "../../../../request-body";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../../../vercel/proxy-api";

export async function POST(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  try {
    const body = JSON.parse(new TextDecoder().decode(await readBodyBytes(request, 16_000)));
    if (typeof body?.payload !== "string") return new Response(null, {status: 400});
    await processAppleNotification(body.payload);
    return new Response(null, {status: 200});
  } catch { return new Response(null, {status: 400}); }
}
