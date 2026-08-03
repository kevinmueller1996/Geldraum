"use client";

import { FormEvent, useEffect, useState } from "react";

export default function ResetPasswordPage() {
  const [token] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    window.history.replaceState(null, "", "/passwort-zuruecksetzen");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!token) return setError("Der Link ist ungültig oder unvollständig.");
    if (password !== confirmation) return setError("Die beiden Passwörter stimmen nicht überein.");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Das Passwort konnte nicht geändert werden.");
      window.location.replace("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Das Passwort konnte nicht geändert werden.");
      setLoading(false);
    }
  }

  return <main className="auth-shell reset-shell">
    <section className="auth-card login-card">
      <a className="brand-lockup" href="/login" aria-label="Zur Njora-Anmeldung"><img className="brand-mark" src="/njora-mark.png" width="42" height="42" alt="" /><img className="brand-wordmark" src="/njora-wordmark.png" width="112" height="35" alt="" /></a>
      <p className="eyebrow">Kontosicherheit</p>
      <h1>Neues Passwort.<br /><em>Sicher weiter.</em></h1>
      <p>Wähle ein neues Passwort mit mindestens zehn Zeichen. Nach der Änderung werden alle bisherigen Sitzungen beendet.</p>
      <form className="login-form" onSubmit={submit}>
        <label>Neues Passwort<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={10} maxLength={72} /></label>
        <label>Passwort wiederholen<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={10} maxLength={72} /></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="auth-button login-submit" type="submit" disabled={loading}>{loading ? "Bitte einen Moment …" : "Passwort speichern"}<b>→</b></button>
      </form>
    </section>
    <aside className="auth-visual login-visual" aria-hidden="true"><div className="brand-story-lockup"><img src="/njora-mark.png" width="260" height="260" alt="" /><img src="/njora-wordmark.png" width="300" height="94" alt="" /></div><div className="brand-story-rule" /><div className="brand-story-copy"><strong>Verstehe, was war.</strong><em>Gestalte, was kommt.</em><span>Dein persönlicher Finanzüberblick</span></div></aside>
  </main>;
}
