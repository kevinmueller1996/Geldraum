import { readFormObject } from "../../request-body";
import { NextRequest, NextResponse } from "next/server";
import { getSessionIdentity } from "../../password-auth";
import { billingEnabled, checkout, confirmApple, portal, subscriber } from "../../billing/subscription";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../vercel/proxy-api";

export const dynamic = "force-dynamic";
function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  if (request.headers.get("origin") !== request.nextUrl.origin) return json({error:"Unzulässige Anfrage."},403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({error:"JSON erwartet."},415);
  const user = await getSessionIdentity(request);
  if (!user) return json({authenticated:false},401);
  const body = await readFormObject(request);
  if (!body || typeof body.action !== "string" || !["checkout","portal","apple"].includes(body.action)) return json({error:"Unbekannte Aktion."},400);
  if (!billingEnabled(body.action === "apple" ? user.id : undefined)) return json({error:"Der Aboverkauf ist noch nicht geöffnet."},409);
  try {
    const row=await subscriber(user.id, user.accountCreatedAt);
    if(body.action==="apple") {
      if(typeof body.transaction!=="string" || typeof body.environment!=="string") return json({error:"Kaufdaten fehlen."},400);
      return json(await confirmApple(row,body.transaction,body.environment));
    }
    return json({url:body.action==="checkout"?await checkout(row,user.email):await portal(row)});
  } catch {
    return json({error:"Die Abrechnung konnte nicht bestätigt werden. Bitte prüfe dein Abo und versuche es erneut."},503);
  }
}
