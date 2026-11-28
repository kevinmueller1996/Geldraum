import { NextRequest, NextResponse } from "next/server";
import { sendInvitationEmailCode } from "../../../auth-email";
import { hashAppleValue, randomAppleValue } from "../../../apple-tokens";
import { ensureAuthSchema, getSessionIdentity, normalizeEmail, userId } from "../../../password-auth";
import { readFormObject } from "../../../request-body";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../../vercel/proxy-api";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers: {"Cache-Control": "private, no-store"}});
const error = (message: string, status: number) => json({error: message}, status);

export async function GET(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  const identity = await getSessionIdentity(request);
  if (!identity) return error("Bitte melde dich bei Njora an.", 401);
  const db = await ensureAuthSchema();
  const row = await db.prepare("SELECT email_address FROM auth_email_aliases WHERE user_id=?").bind(identity.id).first<{email_address: string}>();
  return json({email: row?.email_address ?? null});
}

export async function POST(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  if (request.headers.get("origin") !== request.nextUrl.origin ||
      !request.headers.get("content-type")?.startsWith("application/json")) return error("Unzulässige Anfrage.", 403);
  try {
    const identity = await getSessionIdentity(request);
    if (!identity) return error("Bitte melde dich bei Njora an.", 401);
    const db = await ensureAuthSchema();
    const body = await readFormObject(request);
    const now = new Date().toISOString();
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const lifetime = "EXISTS (SELECT 1 FROM users u JOIN auth_credentials c ON c.user_id=u.id WHERE u.id=? AND u.created_at=? AND c.email_verified_at IS NOT NULL)";
    const self = [identity.id, identity.accountCreatedAt];
    if (body?.action === "send") {
      const email = normalizeEmail(body.email);
      if (!email || email === identity.email) return error("Gib eine andere E-Mail-Adresse für Einladungen ein.", 400);
      const emailID = await userId(email);
      const code = randomAppleValue().slice(0, 16);
      // The default registration ID and the alias are mutually exclusive.
      const [, created] = await db.batch([
        db.prepare("DELETE FROM auth_email_alias_codes WHERE created_at<=?").bind(hourAgo),
        db.prepare(`INSERT INTO auth_email_alias_codes(code_hash,user_id,email_id,email_address,created_at)
          SELECT ?,?,?,?,? WHERE ${lifetime}
          AND NOT EXISTS (SELECT 1 FROM users WHERE id=?)
          AND NOT EXISTS (SELECT 1 FROM auth_email_aliases WHERE email_id=? OR user_id=?)
          AND (SELECT COUNT(*) FROM auth_email_alias_codes WHERE user_id=?)<5
          AND (SELECT COUNT(*) FROM auth_email_alias_codes WHERE email_id=?)<4`)
          .bind(await hashAppleValue(code), identity.id, emailID, email, now, ...self, emailID, emailID, identity.id, identity.id, emailID),
      ]);
      if (created.meta.changes) await sendInvitationEmailCode(email, code);
      return json({message: "Wenn die Adresse verfügbar ist, erhältst du einen Bestätigungscode per E-Mail."});
    }
    if (body?.action !== "verify" || typeof body.code !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(body.code.trim())) {
      return error("Gib den Bestätigungscode aus deiner E-Mail ein.", 400);
    }
    const hash = await hashAppleValue(body.code.trim());
    const cutoff = new Date(Date.now() - 20 * 60_000).toISOString();
    const entry = await db.prepare(`SELECT email_id,email_address FROM auth_email_alias_codes
      WHERE code_hash=? AND user_id=? AND consumed_at IS NULL AND created_at>?`).bind(hash, identity.id, cutoff)
      .first<{email_id: string; email_address: string}>();
    if (!entry) return error("Der Code ist ungültig oder abgelaufen.", 400);
    const [verified] = await db.batch([
      db.prepare(`INSERT INTO auth_email_aliases(email_id,user_id,email_address,verified_at)
        SELECT email_id,user_id,email_address,? FROM auth_email_alias_codes
        WHERE code_hash=? AND user_id=? AND consumed_at IS NULL AND created_at>?
          AND ${lifetime} AND NOT EXISTS (SELECT 1 FROM users WHERE id=?)
        ON CONFLICT DO NOTHING`).bind(now, hash, identity.id, cutoff, ...self, entry.email_id),
      db.prepare("UPDATE auth_email_alias_codes SET consumed_at=? WHERE code_hash=? AND user_id=? AND consumed_at IS NULL")
        .bind(now, hash, identity.id),
    ]);
    return verified.meta.changes ? json({email: entry.email_address}) : error("Die E-Mail-Adresse ist bereits vergeben.", 409);
  } catch { return error("Die Bestätigung ist gerade nicht möglich. Bitte versuche es erneut.", 503); }
}
