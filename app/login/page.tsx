"use client";

import { FormEvent, useState } from "react";

type Mode = "login" | "register";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (mode === "register" && password !== confirmation) {
      setError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Die Anmeldung ist fehlgeschlagen.");
      window.location.href = "/";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Die Anmeldung ist fehlgeschlagen.");
      setLoading(false);
    }
  }

  function changeMode(next: Mode) {
    setMode(next);
    setError("");
    setPassword("");
    setConfirmation("");
  }

  return <main className="auth-shell login-shell">
    <section className="auth-card login-card">
      {/* vinext currently renders next/link with a duplicate React instance in development. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a className="brand-lockup" href="/" aria-label="Njora Startseite"><img className="brand-mark" src="/njora-mark.png" alt="" /><img className="brand-wordmark" src="/njora-wordmark.png" alt="" /></a>
      <p className="eyebrow">Dein persönlicher Zugang</p>
      <h1>{mode === "login" ? <>Willkommen<br /><em>zurück.</em></> : <>Dein Raum<br /><em>beginnt hier.</em></>}</h1>
      <p>{mode === "login" ? "Melde dich mit deiner E-Mail-Adresse und deinem persönlichen Passwort an." : "Erstelle deinen geschützten Bereich bei Njora. Wenn du dieselbe E-Mail wie bisher nutzt, bleibt dein vorhandener Finanzplan erhalten."}</p>

      <div className="auth-tabs" role="tablist" aria-label="Anmeldung oder Registrierung">
        <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => changeMode("login")}>Anmelden</button>
        <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => changeMode("register")}>Konto erstellen</button>
      </div>

      <form className="login-form" onSubmit={submit}>
        <label>E-Mail-Adresse<input type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} placeholder="name@beispiel.de" /></label>
        <label>Passwort<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={10} maxLength={72} placeholder="Mindestens 10 Zeichen" /></label>
        {mode === "register" && <label>Passwort wiederholen<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={10} maxLength={72} placeholder="Passwort erneut eingeben" /></label>}
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="auth-button login-submit" type="submit" disabled={loading}>{loading ? "Bitte einen Moment …" : mode === "login" ? "Sicher anmelden" : "Konto erstellen"}<b>→</b></button>
      </form>
      <small>Dein Passwort wird niemals im Klartext gespeichert. Eine Funktion zum Zurücksetzen des Passworts folgt nach der Testphase.</small>
    </section>
    <aside className="auth-visual login-visual" aria-hidden="true"><span>Privat. Direkt. Unabhängig.</span><strong>Dein Njora</strong><div><i /><i /><i /></div><p>Verstehe, was war.<br />Gestalte, was kommt.</p></aside>
  </main>;
}
