"use client";

import { UiIcon } from "../ui-icon";
import { FormEvent, useState } from "react";
import Image from "next/image";
import { AuthResponseError, authMessage, useAuthLinkToken } from "../auth-link";

export default function ResetPasswordPage() {
  const token = useAuthLinkToken();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!token) return setError("Der Link ist ungültig oder unvollständig.");
    if (password !== confirmation) return setError("Die beiden Passwörter stimmen nicht überein.");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new AuthResponseError(data.error || "Das Passwort konnte nicht geändert werden.");
      window.location.replace("/");
    } catch (caught) {
      setError(authMessage(caught, "Das Passwort konnte nicht geändert werden. Bitte prüfe deine Verbindung und versuche es erneut."));
      setLoading(false);
    }
  }

  return <main className="auth-shell reset-shell">
    <section className="auth-card login-card">
      <a className="brand-lockup" href="/login" aria-label="Zur Njora-Anmeldung"><Image unoptimized className="brand-mark" src="/njora-mark-small.webp" width="42" height="42" alt="" /><Image unoptimized className="brand-wordmark" src="/njora-wordmark-small.webp" width="112" height="35" alt="" /></a>
      <p className="eyebrow">Kontosicherheit</p>
      <h1>Neues Passwort.<br /><em>Sicher weiter.</em></h1>
      <p>Wähle ein neues Passwort mit mindestens zehn Zeichen. Nach der Änderung werden alle bisherigen Sitzungen beendet.</p>
      {token === "" ? <div className="login-form">
        <p className="login-error" role="alert">Der Link zum Zurücksetzen ist unvollständig. Öffne den Link aus deiner E-Mail oder fordere einen neuen an.</p>
        <a href="/login#zugang">Zur Anmeldung</a>
      </div> : <form className="login-form" onSubmit={submit}>
        <label>Neues Passwort<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={10} maxLength={72} /></label>
        <label>Passwort wiederholen<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={10} maxLength={72} /></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="auth-button login-submit" type="submit" disabled={loading || token === null}>{loading ? "Bitte einen Moment …" : "Passwort speichern"}<b><UiIcon name="forward" /></b></button>
      </form>}
    </section>
    <aside className="auth-visual login-visual" aria-hidden="true"><div className="brand-story-lockup"><Image unoptimized src="/njora-mark.png" width="260" height="260" alt="" /><Image unoptimized src="/njora-wordmark.png" width="300" height="94" alt="" /></div><div className="brand-story-rule" /><div className="brand-story-copy"><strong>Verstehe, was war.</strong><em>Gestalte, was kommt.</em><span>Dein persönlicher Finanzüberblick</span></div></aside>
  </main>;
}
