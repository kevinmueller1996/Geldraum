"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

export default function ConfirmEmailPage() {
  const token = useRef(typeof window === "undefined" ? "" : new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");

  useEffect(() => {
    window.history.replaceState(null, "", "/email-bestaetigen");
  }, []);

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== repeat) return setError("Die beiden Passwörter stimmen nicht überein.");
    if (!token.current) return setError("Der Link ist ungültig oder unvollständig.");
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.current, password }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Die E-Mail-Adresse konnte nicht bestätigt werden.");
      window.location.replace("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Die E-Mail-Adresse konnte nicht bestätigt werden.");
      setLoading(false);
    }
  }

  return <main className="auth-shell confirm-email-shell">
    <section className="auth-card login-card">
      <a className="brand-lockup" href="/login" aria-label="Zur Njora-Anmeldung"><img className="brand-mark" src="/njora-mark.png" width="42" height="42" alt="" /><img className="brand-wordmark" src="/njora-wordmark.png" width="112" height="35" alt="" /></a>
      <p className="eyebrow">Nur noch ein Schritt</p>
      <h1>E-Mail bestätigen.<br /><em>Njora öffnen.</em></h1>
      <p>Lege jetzt dein Passwort fest und bestätige damit deine E-Mail-Adresse.</p>
      <form className="login-form" onSubmit={confirm}>
        <label>Passwort<input type="password" name="password" autoComplete="new-password" minLength={10} maxLength={72} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>Passwort wiederholen<input type="password" name="password-confirmation" autoComplete="new-password" minLength={10} maxLength={72} required value={repeat} onChange={(event) => setRepeat(event.target.value)} /></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="auth-button" type="submit" disabled={loading}>{loading ? "Wird bestätigt …" : "Konto öffnen"}<b>→</b></button>
      </form>
    </section>
    <aside className="auth-visual login-visual" aria-hidden="true"><div className="brand-story-lockup"><img src="/njora-mark.png" width="260" height="260" alt="" /><img src="/njora-wordmark.png" width="300" height="94" alt="" /></div><div className="brand-story-rule" /><div className="brand-story-copy"><strong>Verstehe, was war.</strong><em>Gestalte, was kommt.</em><span>Dein persönlicher Finanzüberblick</span></div></aside>
  </main>;
}
