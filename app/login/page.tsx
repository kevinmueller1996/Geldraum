"use client";

import { FormEvent, useEffect, useState } from "react";
import { isLocalHostname } from "../local-host";
import LegalLinks from "../legal-links";
import "./landing.css";

type Mode = "login" | "register";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("verification") === "invalid"
    ? "Der Bestätigungslink ist ungültig oder abgelaufen."
    : "");
  const [notice, setNotice] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [loading, setLoading] = useState(false);
  const [local, setLocal] = useState(false);
  const showPassword = mode === "login" || local;

  useEffect(() => {
    setLocal(isLocalHostname(window.location.hostname));
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") === "1") window.location.replace("/");
    if (params.get("start") === "register") {
      setMode("register");
      document.getElementById("zugang")?.scrollIntoView({ block: "start" });
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setNeedsVerification(false);
    if (mode === "register" && showPassword && password !== confirmation) {
      setError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(showPassword ? { email, password } : { email }),
      });
      const data = await response.json() as { error?: string; code?: string; verificationRequired?: boolean; message?: string };
      if (!response.ok) {
        if (data.code === "email_unverified") setNeedsVerification(true);
        throw new Error(data.error || "Die Anmeldung ist fehlgeschlagen.");
      }
      if (data.verificationRequired) {
        setNotice(data.message || "Bitte bestätige deine E-Mail-Adresse über den Link in deinem Postfach.");
        setLoading(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("weiter");
      const target = next ? new URL(next, window.location.origin) : null;
      const allowed = ["/api/chatgpt/authorize", "/api/chatgpt/confirm", "/api/chatgpt/manage"];
      window.location.href = target && target.origin === window.location.origin && allowed.includes(target.pathname)
        ? target.pathname + target.search : "/";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Die Anmeldung ist fehlgeschlagen.");
      setLoading(false);
    }
  }

  function changeMode(next: Mode) {
    setMode(next);
    setError("");
    setNotice("");
    setNeedsVerification(false);
    setPassword("");
    setConfirmation("");
  }

  function openAccess(next: Mode) {
    changeMode(next);
    const heading = document.getElementById("access-title");
    heading?.focus({ preventScroll: true });
    document.getElementById("zugang")?.scrollIntoView({ block: "start" });
  }

  async function requestEmailAction(kind: "resend-verification" | "forgot-password") {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/auth/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error || "Die Anfrage konnte nicht verarbeitet werden.");
      setNotice(data.message || "Bitte prüfe dein E-Mail-Postfach.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Die Anfrage konnte nicht verarbeitet werden.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="nj-landing" id="start">
    <header className="nj-header nj-wrap">
      <a className="nj-brand" href="#start" aria-label="Njora Startseite"><img src="/njora-mark.png" width="40" height="40" alt="" /><img src="/njora-wordmark.png" width="105" height="26" alt="Njora" /></a>
      <nav aria-label="Seitennavigation"><a href="#produkt">Einblick</a><a href="#preis">Preis</a><a href="#faq">Fragen</a></nav>
      <button className="nj-secondary" type="button" onClick={() => openAccess("login")}>Anmelden</button>
    </header>

    <section className="nj-wrap nj-hero" aria-labelledby="hero-title">
      <div className="nj-copy">
        <p className="nj-kicker">Dein persönlicher Finanzplan</p>
        <h1 id="hero-title">Was bleibt am<br /><em>Monatsende?</em></h1>
        <p className="nj-lead">Dein Kontostand zeigt dir, was heute da ist. Njora rechnet die anstehenden Einnahmen und Ausgaben dazu. So siehst du, wie viel bis Monatsende voraussichtlich bleibt.</p>
        <div className="nj-actions"><button type="button" className="nj-primary" onClick={() => openAccess("register")}>Konto erstellen</button><a href="#produkt">Monatsplan ansehen</a></div>
        <p className="nj-footnote">Manuelle Eingabe · Ohne Bankverbindung</p>
      </div>
      <figure className="nj-stage">
        <img className="nj-phone" src="/njora-heute-demo.png" width="354" height="770" alt="Die Heute-Ansicht der iPhone-App mit Monatsendprognose, Einkommen, Fixkosten und Kontoverlauf." fetchPriority="high" />
        <figcaption>iPhone-Vorschau · Beispieldaten</figcaption>
      </figure>
    </section>

    <section className="nj-feature nj-wrap" id="produkt" aria-labelledby="plan-title">
      <div id="funktionen"><p className="nj-kicker">Der Monatsplan</p><h2 id="plan-title">Auch die Jahresrechnung<br /><em>hat ihren Platz.</em></h2>
        <p>Die Versicherung wird einmal im Jahr fällig, die Miete jeden Monat. Njora rechnet beides auf den Monat um. Kreditraten zählen mit, damit du deinen Spielraum siehst.</p>
        <p>Für die Monatsendprognose zählt dagegen der Buchungstag. In der App kannst du jede geplante Zahlung öffnen und Betrag oder Fälligkeit anpassen.</p>
      </div>
      <figure className="nj-ledger"><figcaption>Ein Monat in Zahlen <small>Beispiel</small></figcaption>
        <dl><div><dt>Einkommen</dt><dd>3.000 €</dd></div><div><dt>Monatliche Fixkosten</dt><dd>−1.650 €</dd></div><div><dt>Kreditrate</dt><dd>−250 €</dd></div><div><dt>Versicherung <small>600 € im Jahr ÷ 12</small></dt><dd>−50 €</dd></div><div className="nj-total"><dt>Freier Spielraum</dt><dd>1.050 €</dd></div></dl>
      </figure>
    </section>

    <section className="nj-access nj-wrap" aria-labelledby="access-title">
      <div className="nj-price" id="preis"><p className="nj-kicker">Das Njora-Monatsabo</p><h2>0,99 € <small>pro Monat</small></h2><p>Zum Verkaufsstart erhältst du beim ersten Web-Abo 30 Tage kostenlos. Danach verlängert sich das Abo automatisch um jeweils einen Monat.</p>
        <p>Du kannst jederzeit zum Ende des laufenden Zeitraums kündigen. Die Registrierung allein löst keine Zahlung aus.</p>
      </div>
      <aside className="landing-auth-card nj-form" id="zugang">
        <h2 id="access-title" tabIndex={-1}>{mode === "login" ? "Willkommen zurück." : "Dein Njora-Konto."}</h2>
        <p>{mode === "login" ? "Öffne deinen persönlichen Finanzplan." : "Wir schicken dir einen Link, über den du deine E-Mail-Adresse bestätigst und dein Passwort festlegst."}</p>
        <div className="auth-tabs" aria-label="Anmeldung oder Registrierung">
          <button type="button" aria-pressed={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => changeMode("login")}>Anmelden</button>
          <button type="button" aria-pressed={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => changeMode("register")}>Konto erstellen</button>
        </div>
        <form className="login-form" onSubmit={submit}>
          <label>E-Mail-Adresse<input type="email" name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} placeholder="name@beispiel.de" /></label>
          {showPassword && <label>Passwort<input type="password" name="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={10} maxLength={72} placeholder="Mindestens 10 Zeichen" /></label>}
          {mode === "register" && showPassword && <label>Passwort wiederholen<input type="password" name="password-confirmation" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={10} maxLength={72} placeholder="Passwort erneut eingeben" /></label>}
          {error && <p className="login-error" role="alert">{error}</p>}
          {notice && <p className="login-notice" role="status">{notice}</p>}
          {needsVerification && <button className="login-link-button" type="button" disabled={loading || !email} onClick={() => requestEmailAction("resend-verification")}>Bestätigungs-E-Mail erneut senden</button>}
          {mode === "register" && <small>Du erstellst zunächst dein Konto. Das Monatsabo für deinen Finanzplan schließt du separat ab. Es gelten die <a href="/nutzungsbedingungen" target="_blank" rel="noopener">AGB</a>. Hier findest du die <a href="/datenschutz" target="_blank" rel="noopener">Datenschutzerklärung</a>.</small>}
          <button className="auth-button login-submit" type="submit" disabled={loading}>{loading ? "Bitte einen Moment …" : mode === "login" ? "Anmelden" : local ? "Konto erstellen" : "Bestätigungslink senden"}</button>
          {mode === "login" && <button className="login-link-button" type="button" disabled={loading || !email} onClick={() => requestEmailAction("forgot-password")}>Passwort vergessen?</button>}
        </form>
      </aside>
    </section>

    <section className="nj-faq nj-wrap" id="faq" aria-labelledby="faq-title">
      <div><p className="nj-kicker">Häufige Fragen</p><h2 id="faq-title">Vor dem Start.</h2></div>
      <div>
        <details id="ablauf"><summary>Was brauche ich für meinen ersten Plan?</summary><p>Starte mit deinem aktuellen Kontostand, deinem regelmäßigen Einkommen und den wichtigsten Fixkosten. Kredite, Rücklagen und Sparziele kannst du später ergänzen.</p></details>
        <details id="datenschutz"><summary>Braucht Njora Zugriff auf mein Bankkonto?</summary><p>Du trägst Beträge und Buchungstage selbst ein. Eine IBAN oder Zugangsdaten zum Onlinebanking brauchst du dafür nicht. Deinen Plan kannst du exportieren und dein Konto in den Einstellungen löschen. <a href="/datenschutz">Zum Datenschutz</a></p></details>
        <details><summary>Wo kann ich Njora nutzen?</summary><p>Die Web-App läuft im Browser auf Handy, Tablet und Computer. Die native App für iPhone und iPad wird für den App Store vorbereitet.</p></details>
        <details><summary>Wie kündige ich mein Web-Abo?</summary><p>Du kannst dein Abo online kündigen. Wenn du während der Gratisphase zum Ende der Testzeit kündigst, fällt keine erste Monatszahlung an. <a href="/kuendigen">Zur Kündigung</a></p></details>
      </div>
    </section>
    <footer className="nj-footer nj-wrap">
      <span className="nj-credit">Njora by <a href="https://www.rheinland-solutions.de/"><img src="/rheinland-solutions.png" width="432" height="89" alt="Rheinland Solutions" /></a></span>
      <LegalLinks />
    </footer>
  </main>;
}
