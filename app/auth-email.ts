import { env } from "cloudflare:workers";

type AuthMailPurpose = "verify_email" | "password_reset";
type MailEnv = typeof env & {
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  AUTH_PUBLIC_ORIGIN?: string;
};

function mailEnv() {
  return env as MailEnv;
}

export function authEmailConfigured() {
  const runtime = mailEnv();
  return Boolean(runtime.RESEND_API_KEY?.trim() && runtime.AUTH_EMAIL_FROM?.trim());
}

export function authPublicOrigin() {
  const value = mailEnv().AUTH_PUBLIC_ORIGIN?.trim() || "https://njora.de";
  const origin = new URL(value);
  if (origin.protocol !== "https:" && origin.hostname !== "localhost") throw new Error("AUTH_PUBLIC_ORIGIN must use HTTPS");
  return origin;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

async function idempotencyKey(purpose: AuthMailPurpose, token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${purpose}:${token}`));
  return `${purpose}-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
}

export async function sendAuthEmail(to: string, token: string, purpose: AuthMailPurpose) {
  const runtime = mailEnv();
  const apiKey = runtime.RESEND_API_KEY?.trim();
  const from = runtime.AUTH_EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new Error("Transactional email is not configured");

  const url = new URL(purpose === "verify_email" ? "/email-bestaetigen" : "/passwort-zuruecksetzen", authPublicOrigin());
  url.hash = `token=${encodeURIComponent(token)}`;
  const action = purpose === "verify_email" ? "E-Mail-Adresse bestätigen" : "Passwort neu setzen";
  const intro = purpose === "verify_email"
    ? "Bestätige deine E-Mail-Adresse und wähle dein Passwort, um dein Njora-Konto zu öffnen."
    : "Über diesen einmalig nutzbaren Link kannst du ein neues Passwort für dein Njora-Konto festlegen.";
  const expiry = purpose === "verify_email" ? "24 Stunden" : "30 Minuten";
  const safeUrl = escapeHtml(url.toString());

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": await idempotencyKey(purpose, token),
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: purpose === "verify_email" ? "Bestätige deine E-Mail für Njora" : "Dein Njora-Passwort zurücksetzen",
      text: `${intro}\n\n${action}: ${url.toString()}\n\nDer Link ist ${expiry} gültig. Falls du das nicht angefordert hast, ignoriere diese Nachricht.`,
      html: `<!doctype html><html lang="de"><body style="margin:0;background:#f5f0e8;color:#34201b;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:48px 24px"><p style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#4a2b24">NJORA</p><h1 style="font-family:Georgia,serif;font-size:38px;font-weight:400;line-height:1.08;margin:28px 0 18px">${action}</h1><p style="font-size:16px;line-height:1.65;color:#74645e">${intro}</p><p style="margin:30px 0"><a href="${safeUrl}" style="display:inline-block;padding:15px 20px;border-radius:12px;background:#4a2b24;color:#fffaf4;text-decoration:none;font-weight:700">${action}</a></p><p style="font-size:13px;line-height:1.6;color:#74645e">Der Link ist ${expiry} gültig. Falls du das nicht angefordert hast, kannst du diese Nachricht ignorieren.</p></div></body></html>`,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Transactional email provider returned ${response.status}`);
}
