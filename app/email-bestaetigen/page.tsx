"use client";

import { type FormEvent, useState } from "react";
import Image from "next/image";
import { AuthResponseError, authMessage, useAuthLinkToken } from "../auth-link";

export default function ConfirmEmailPage() {
  const token = useAuthLinkToken();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== repeat) return setError("Die beiden Passwörter stimmen nicht überein.");
    if (!token) return setError("Der Link ist ungültig oder unvollständig.");
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new AuthResponseError(data.error || "Die E-Mail-Adresse konnte nicht bestätigt werden.");
      window.location.replace("/");
    } catch (caught) {
      setError(authMessage(caught, "Die E-Mail-Adresse konnte nicht bestätigt werden. Bitte prüfe deine Verbindung und versuche es erneut."));
      setLoading(false);
    }
  }

  return <main className="auth-shell confirm-email-shell">
    <section className="auth-card login-card">
      <a className="brand-lockup" href="/login" aria-label="Zur Njora-Anmeldung"><Image unoptimized className="brand-mark" src="/njora-mark-small.webp" width="42" height="42" alt="" /><Image unoptimized className="brand-wordmark" src="/njora-wordmark-small.webp" width="112" height="35" alt="" /></a>
      <p className="eyebrow">Nur noch ein Schritt</p>
      <h1>E-Mail bestätigen.<br /><em>Njora öffnen.</em></h1>
      <p>Lege jetzt dein Passwort fest und bestätige damit deine E-Mail-Adresse.</p>
      {token === "" ? <div className="login-form">
        <p className="login-error" role="alert">Der Bestätigungslink ist unvollständig. Öffne den Link aus deiner E-Mail oder fordere einen neuen an.</p>
        <a href="/login#zugang">Zur Anmeldung</a>
      </div> : <form className="login-form" onSubmit={confirm}>
        <label>Passwort<input type="password" name="password" autoComplete="new-password" minLength={10} maxLength={72} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>Passwort wiederholen<input type="password" name="password-confirmation" autoComplete="new-password" minLength={10} maxLength={72} required value={repeat} onChange={(event) => setRepeat(event.target.value)} /></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        <small>Mit dem Öffnen deines Kontos akzeptierst du die <a href="/nutzungsbedingungen" target="_blank" rel="noopener">AGB</a>. Informationen zur Datenverarbeitung findest du im <a href="/datenschutz" target="_blank" rel="noopener">Datenschutz</a>.</small>
        <button className="auth-button" type="submit" disabled={loading || token === null}>{loading ? "Wird bestätigt …" : "Konto öffnen"}<b>→</b></button>
      </form>}
    </section>
    <aside className="auth-visual login-visual" aria-hidden="true"><div className="brand-story-lockup"><Image unoptimized src="/njora-mark.png" width="260" height="260" alt="" /><Image unoptimized src="/njora-wordmark.png" width="300" height="94" alt="" /></div><div className="brand-story-rule" /><div className="brand-story-copy"><strong>Verstehe, was war.</strong><em>Gestalte, was kommt.</em><span>Dein persönlicher Finanzüberblick</span></div></aside>
  </main>;
}
