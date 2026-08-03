"use client";

import { FormEvent, useEffect, useState } from "react";

type Mode = "login" | "register";

function ProductOverview() {
  return <div className="product-shot overview-shot" role="img" aria-label="Njora Startübersicht mit Kontostand, Monatsprognose und Budgetaufteilung">
    <div className="product-shot-bar"><span className="product-shot-brand"><img src="/njora-mark.png" width="24" height="24" alt="" />NJORA</span><span>Heute&nbsp;&nbsp; Monat&nbsp;&nbsp; Kredite&nbsp;&nbsp; Ziele</span><b>KM</b></div>
    <div className="product-shot-body">
      <div className="product-shot-heading"><div><small>Guten Abend, Mia</small><strong>Dein Finanzüberblick</strong></div><button type="button" tabIndex={-1}>Kontostände aktualisieren</button></div>
      <div className="product-kpi featured"><small>Aktueller Kontostand</small><strong>3.230 €</strong><span>3.850 € verfügbar · 620 € Karten</span><i /></div>
      <div className="product-kpi"><small>Prognose Monatsende</small><strong>2.740 €</strong><span>auf Basis deiner Planung</span></div>
      <div className="product-kpi"><small>Frei pro Monat</small><strong>1.570 €</strong><span>nach Rücklagen und Raten</span></div>
      <div className="product-flow"><div><small>Dein Monat</small><strong>Wohin dein Geld geht</strong></div><span><i />Wohnen</span><span><i />Lebenshaltung</span><span><i />Rücklagen</span><b>4.200 €</b></div>
    </div>
  </div>;
}

function MonthPreview() {
  return <div className="product-shot compact-shot month-shot" role="img" aria-label="Njora Monatsplan mit Einnahmen, Ausgaben und Jahresrücklage">
    <div className="mini-shot-head"><span>PLAN FÜR AUGUST</span><b>Wohin dein Geld geht</b></div>
    <div className="mini-summary"><span><small>Einnahmen</small><strong>4.200 €</strong></span><span><small>Verplant</small><strong>2.630 €</strong></span></div>
    <div className="mini-distribution"><i style={{ width: "48%" }} /><i style={{ width: "24%" }} /><i style={{ width: "16%" }} /><i style={{ width: "12%" }} /></div>
    <div className="mini-row"><span><i />Wohnen<small>Miete & Nebenkosten</small></span><b>1.250 €</b></div>
    <div className="mini-row"><span><i />Lebenshaltung<small>Einkauf & Alltag</small></span><b>620 €</b></div>
    <div className="mini-row"><span><i />Jahresrücklage<small>Versicherungen & Beiträge</small></span><b>90 €</b></div>
  </div>;
}

function GoalsPreview() {
  return <div className="product-shot compact-shot goals-shot" role="img" aria-label="Njora Zielplanung mit Sparfortschritt und Machbarkeitscheck">
    <div className="mini-shot-head"><span>ZIELE & PROJEKTE</span><b>Wofür du Raum schaffst</b></div>
    <div className="goal-preview-card"><div><span>Notgroschen</span><b>70%</b></div><strong>8.400 € <small>von 12.000 €</small></strong><i><b style={{ width: "70%" }} /></i><small>3.600 € offen · flexibel aus Überschuss</small></div>
    <div className="goal-preview-card coral"><div><span>Großer Wunsch</span><b>30%</b></div><strong>1.800 € <small>von 6.000 €</small></strong><i><b style={{ width: "30%" }} /></i><small>550 € monatlich eingeplant</small></div>
    <div className="feasibility"><span>Machbarkeitscheck</span><strong>1.020 € bleiben rechnerisch frei.</strong></div>
  </div>;
}

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") === "1") window.location.replace("/");
    if (params.get("start") === "register") setMode("register");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setNeedsVerification(false);
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
      window.location.href = "/";
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
    window.setTimeout(() => document.getElementById("zugang")?.scrollIntoView({ behavior: "smooth", block: "center" }), 20);
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

  return <main className={`marketing-page ${mode === "register" ? "registration-mode" : "login-mode"}`}>
    <header className="marketing-header">
      <a className="marketing-brand" href="#start" aria-label="Njora Start"><img src="/njora-mark.png" width="38" height="38" alt="" /><img src="/njora-wordmark.png" width="112" height="22" alt="Njora" /></a>
      <nav aria-label="Seitennavigation"><a href="#funktionen">Funktionen</a><a href="#produkt">Produkt</a><a href="#ablauf">So funktioniert’s</a><a href="#datenschutz">Datenschutz</a><a href="#faq">FAQ</a></nav>
      <button type="button" onClick={() => openAccess("login")}>Anmelden <span>→</span></button>
    </header>

    <section className="landing-hero" id="start">
      <div className="hero-copy">
        <p className="marketing-eyebrow">Dein persönlicher Finanzüberblick</p>
        <h1>Verstehe, was war.<br /><em>Gestalte, was kommt.</em></h1>
        <p className="hero-intro">Njora bringt Kontostände, laufende Kosten, Jahresausgaben, Kredite und Sparziele in eine ruhige Übersicht. Ohne Bankzugriff – du entscheidest, welche Werte du einträgst.</p>
        <div className="hero-actions"><button type="button" onClick={() => openAccess("register")}>Testzugang erstellen <span>→</span></button><a href="#produkt">Produkt ansehen</a></div>
        <ul className="proof-chips"><li>Keine IBAN erforderlich</li><li>Daten exportierbar</li><li>Jederzeit löschbar</li></ul>
        <ProductOverview />
      </div>

      <aside className="landing-auth-card" id="zugang" aria-labelledby="access-title">
        <p className="marketing-eyebrow">Dein persönlicher Bereich</p>
        <h2 id="access-title">{mode === "login" ? "Willkommen zurück." : "In wenigen Minuten startklar."}</h2>
        <p>{mode === "login" ? "Melde dich an und öffne deinen persönlichen Finanzüberblick." : "Erstelle deinen geschützten Testzugang. Deinen Finanzplan richtest du anschließend Schritt für Schritt ein."}</p>
        <div className="auth-tabs" aria-label="Anmeldung oder Registrierung">
          <button type="button" aria-pressed={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => changeMode("login")}>Anmelden</button>
          <button type="button" aria-pressed={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => changeMode("register")}>Konto erstellen</button>
        </div>
        <form className="login-form" onSubmit={submit}>
          <label>E-Mail-Adresse<input type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} placeholder="name@beispiel.de" /></label>
          <label>Passwort<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={10} maxLength={72} placeholder="Mindestens 10 Zeichen" /></label>
          {mode === "register" && <label>Passwort wiederholen<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={10} maxLength={72} placeholder="Passwort erneut eingeben" /></label>}
          {error && <p className="login-error" role="alert">{error}</p>}
          {notice && <p className="login-notice" role="status">{notice}</p>}
          {needsVerification && <button className="login-link-button" type="button" disabled={loading || !email} onClick={() => requestEmailAction("resend-verification")}>Bestätigungs-E-Mail erneut senden</button>}
          <button className="auth-button login-submit" type="submit" disabled={loading}>{loading ? "Bitte einen Moment …" : mode === "login" ? "Sicher anmelden" : "Testzugang erstellen"}<b>→</b></button>
          {mode === "login" && <button className="login-link-button" type="button" disabled={loading || !email} onClick={() => requestEmailAction("forgot-password")}>Passwort vergessen?</button>}
        </form>
        <small>Dein Passwort wird niemals im Klartext gespeichert. Njora befindet sich aktuell in der Testphase.</small>
      </aside>
    </section>

    <section className="landing-section benefits-section" id="funktionen">
      <div className="section-heading"><p className="marketing-eyebrow">Finanzen ohne Tabellenchaos</p><h2>Wissen, was bleibt –<br /><em>bevor der Monat vorbei ist.</em></h2><p>Einzelne Kontostände erzählen nur einen Teil der Geschichte. Njora verbindet deinen heutigen Stand mit regelmäßigen Ausgaben, Jahreskosten, Verpflichtungen und Zielen.</p></div>
      <div className="benefit-grid">
        <article><span>01</span><h3>Monat verstehen</h3><p>Erkenne, was regelmäßig hereinkommt, was fest verplant ist und welcher Spielraum bleibt.</p></article>
        <article><span>02</span><h3>Jahr vorausdenken</h3><p>Lege Versicherungen, Beiträge und andere Jahreskosten ihrem Fälligkeitsmonat zu.</p></article>
        <article><span>03</span><h3>Ziele realistisch planen</h3><p>Sieh, welcher monatliche Betrag für ein Ziel nötig wäre – gemeinsam mit deinen Verpflichtungen.</p></article>
      </div>
    </section>

    <section className="landing-section product-section" id="produkt">
      <div className="section-heading centered"><p className="marketing-eyebrow">Ein ruhiger Blick auf deine Zahlen</p><h2>Eine Zahl für heute.<br /><em>Ein Blick auf morgen.</em></h2><p>Die Produktansichten zeigen Njora mit vollständig erfundenen Demodaten.</p></div>
      <div className="product-feature overview-feature"><div><p className="marketing-eyebrow">Deine Startübersicht</p><h3>Erkennen, was sich gerade verändert.</h3><p>Kontostände aktualisieren, Monatsprognose prüfen und Veränderungen früh erkennen – ohne erst mehrere Konten und Tabellen abzugleichen.</p><ul><li>Aktueller Nettostand</li><li>Prognose zum Monatsende</li><li>Verfügbarer Spielraum</li></ul></div><ProductOverview /></div>
      <div className="product-feature-grid">
        <article className="product-feature-card"><MonthPreview /><div><p className="marketing-eyebrow">Monatsplan</p><h3>Regelmäßiges und Unregelmäßiges gehört zusammen.</h3><p>Njora verteilt Jahreskosten rechnerisch auf den Monat und zeigt, wie viel bereits verplant ist.</p></div></article>
        <article className="product-feature-card"><GoalsPreview /><div><p className="marketing-eyebrow">Ziele & Kredite</p><h3>Planen, ohne Verpflichtungen auszublenden.</h3><p>Sparziele, Kredite und verfügbarer Überschuss bleiben in derselben Planung sichtbar.</p></div></article>
      </div>
    </section>

    <section className="landing-section steps-section" id="ablauf">
      <div className="section-heading"><p className="marketing-eyebrow">So funktioniert Njora</p><h2>Einmal einrichten.<br /><em>Kurz aktuell halten.</em></h2></div>
      <ol className="steps-list"><li><span>1</span><div><h3>Grundlage erfassen</h3><p>Konten, Einkommen und wichtige Ausgaben in einem kurzen, geführten Fragebogen eintragen.</p></div></li><li><span>2</span><div><h3>Regelmäßig einchecken</h3><p>Aktuelle Kontostände in wenigen Augenblicken aktualisieren.</p></div></li><li><span>3</span><div><h3>Mit Klarheit entscheiden</h3><p>Monatsverlauf, Verpflichtungen und Ziele gemeinsam betrachten.</p></div></li></ol>
      <p className="planning-note">Prognosen basieren auf deinen Eingaben und dienen als Planungshilfe, nicht als Finanzberatung.</p>
    </section>

    <section className="privacy-section" id="datenschutz">
      <div><p className="marketing-eyebrow">Datenminimierung statt Bankzugriff</p><h2>Deine Zahlen brauchen<br /><em>keine Kontoverknüpfung.</em></h2><p>Für Njora reichen selbst eingetragene Namen und Beträge. Eine IBAN oder Verbindung zu deinem Onlinebanking ist nicht erforderlich.</p></div>
      <ul><li><span>✓</span><div><strong>Kein Klartext-Passwort</strong><small>Passwörter werden verschlüsselt gehasht gespeichert.</small></div></li><li><span>✓</span><div><strong>Persönlich zugeordnet</strong><small>Deine Finanzdaten bleiben deinem Konto zugeordnet.</small></div></li><li><span>✓</span><div><strong>Exportierbar</strong><small>Du kannst deinen Finanzplan als Datei mitnehmen.</small></div></li><li><span>✓</span><div><strong>Löschbar</strong><small>Account und Finanzdaten lassen sich in der App löschen.</small></div></li></ul>
    </section>

    <section className="landing-section test-cta-section">
      <img src="/njora-mark.png" width="130" height="130" alt="" />
      <p className="marketing-eyebrow">Njora mitgestalten</p><h2>Mehr Überblick beginnt<br /><em>mit dem ersten Eintrag.</em></h2><p>Erstelle einen Testzugang und probiere Njora mit deinen eigenen Zahlen aus. Während der Testphase können sich Funktionen und Oberfläche noch weiterentwickeln.</p>
      <div className="hero-actions centered-actions"><button type="button" onClick={() => openAccess("register")}>Testzugang erstellen <span>→</span></button><button className="text-action" type="button" onClick={() => openAccess("login")}>Schon registriert? Anmelden</button></div>
    </section>

    <section className="landing-section faq-section" id="faq">
      <div className="section-heading"><p className="marketing-eyebrow">Häufige Fragen</p><h2>Klarheit beginnt<br /><em>vor dem ersten Eintrag.</em></h2></div>
      <div className="faq-list">
        <details><summary>Muss ich mein Bankkonto verbinden?<span>+</span></summary><p>Nein. Du trägst nur die Bezeichnungen und Beträge ein, die du für deine Übersicht nutzen möchtest.</p></details>
        <details><summary>Welche Daten brauche ich für den Start?<span>+</span></summary><p>Ein Profilname, mindestens ein Kontostand und ein monatliches Einkommen reichen aus. Weitere Angaben sind optional und können später ergänzt werden.</p></details>
        <details><summary>Wie entstehen die Prognosen?<span>+</span></summary><p>Njora berechnet sie aus deinen eingetragenen Einnahmen, Ausgaben, Buchungstagen, Jahreskosten und Verpflichtungen.</p></details>
        <details><summary>Kann ich meine Daten mitnehmen oder löschen?<span>+</span></summary><p>Ja. Du kannst deinen Finanzplan exportieren und deinen Account einschließlich der zugehörigen Finanzdaten löschen.</p></details>
        <details><summary>Wann wird die E-Mail-Adresse bestätigt?<span>+</span></summary><p>Njora befindet sich derzeit in der Testphase. Die technische E-Mail-Bestätigung ist vorbereitet und wird vor dem öffentlichen Marktstart verpflichtend aktiviert.</p></details>
        <details><summary>Ersetzt Njora eine Finanzberatung?<span>+</span></summary><p>Nein. Njora ist ein persönliches Planungs- und Übersichtswerkzeug.</p></details>
      </div>
    </section>

    <footer className="marketing-footer"><a className="marketing-brand" href="#start"><img src="/njora-mark.png" width="34" height="34" alt="" /><img src="/njora-wordmark.png" width="105" height="20" alt="Njora" /></a><p>Verstehe, was war. <em>Gestalte, was kommt.</em></p><small>© {new Date().getFullYear()} Njora · Persönlicher Finanzüberblick in der Testphase</small></footer>
  </main>;
}
