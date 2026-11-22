import { readFormObject } from "../../request-body";
import { env } from "cloudflare:workers";
import { validCalendarDay } from "../../plan-validation";
import { normalizeEmail } from "../../password-auth";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../vercel/proxy-api";

export const dynamic = "force-dynamic";
const support = "info@rheinland-solutions.de";
function reply(body: unknown, status = 200) {
  return Response.json(body, {status, headers: {"Cache-Control": "no-store"}});
}

export async function POST(request: Request) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply({error:"Unzulässige Anfrage."},403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply({error:"JSON erwartet."},415);
  const data = await readFormObject(request);
  if (!data || typeof data !== "object") return reply({error:"Angaben fehlen."},400);
  const email = normalizeEmail(data.email);
  const confirmation = data.reply ? normalizeEmail(data.reply) : email;
  const clean = (text: unknown, max: number) => typeof text === "string" && text.length <= max ? text.trim() : "";
  const name = clean(data.name,120);
  const contract = clean(data.contract,120);
  const special = data.kind === "extraordinary";
  if (!name || !contract || !email || !confirmation || (!special && data.kind !== "ordinary") || (data.end && !validCalendarDay(data.end))) {
    return reply({error:"Bitte prüfe die Vertrags- und Kontaktdaten."},400);
  }
  try {
    // Cap repeated mail to the same recipient. No account lookup or financial data is exposed here.
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS njora_cancellation_limits (recipient TEXT PRIMARY KEY, bucket INTEGER NOT NULL, count INTEGER NOT NULL)").run();
    const bucket = Math.floor(Date.now()/3600000);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(confirmation));
    const recipient = Array.from(new Uint8Array(hash), x=>x.toString(16).padStart(2,"0")).join("");
    await env.DB.prepare("DELETE FROM njora_cancellation_limits WHERE bucket < ?").bind(bucket-1).run();
    const allowed = await env.DB.prepare(`INSERT INTO njora_cancellation_limits VALUES (?,?,1)
      ON CONFLICT(recipient) DO UPDATE SET bucket=excluded.bucket,
      count=CASE WHEN bucket=excluded.bucket THEN count+1 ELSE 1 END
      WHERE bucket<>excluded.bucket OR count<5 RETURNING count`).bind(recipient,bucket).first();
    if (!allowed) return reply({error:"Weitere Erklärungen kannst du direkt an "+support+" senden."},429);
    const timestamp = new Date().toISOString();
    const receipt = [
      "Kündigung über njora.de · "+timestamp, contract, name, "Kontoadresse: "+email,
      special ? "Außerordentliche Kündigung" : "Ordentliche Kündigung",
      special && clean(data.reason,800), "Gewünschtes Ende: "+(data.end || "zum nächstmöglichen Zeitpunkt")
    ].filter(Boolean).join("\n");
    const from = env.AUTH_EMAIL_FROM;
    if (typeof from !== "string" || !env.RESEND_API_KEY) throw new Error();
    const sent = await fetch("https://api.resend.com/emails/batch", {
      method:"POST", headers: {Authorization:"Bearer "+env.RESEND_API_KEY, "Content-Type":"application/json"},
      body: JSON.stringify([
        {from,to:[support],subject:"Njora-Web-Abo · Kündigung bearbeiten",text:receipt+"\nBestätigungsadresse: "+confirmation},
        {from,to:[confirmation],subject:"Eingang deiner Njora-Kündigung",text:receipt+"\n\nWir prüfen die Zuordnung und bestätigen dir das Vertragsende."}
      ]), redirect:"manual", signal:AbortSignal.timeout(8000)
    });
    if (!sent.ok) throw new Error();
    return reply({receipt});
  } catch {
    return reply({error:"Die Übermittlung konnte nicht bestätigt werden. Bitte versuche es erneut oder schreibe an "+support+"."},503);
  }
}
