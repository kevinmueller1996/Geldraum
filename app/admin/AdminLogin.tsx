"use client";

import { FormEvent, useState } from "react";
import { AdminBrand } from "./Brand";
import styles from "./admin.module.css";

export function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/admin/session/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Die Anmeldung ist fehlgeschlagen.");
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Die Anmeldung ist fehlgeschlagen.");
      setLoading(false);
    }
  }

  return <main className={styles.loginShell}>
    <section className={styles.loginCard}>
      <AdminBrand />
      <div className={styles.loginCopy}>
        <p className={styles.eyebrow}>Geschützter Betreiberzugang</p>
        <h1>Tester im Blick.<br /><em>Daten im Schutz.</em></h1>
        <p>Melde dich mit deinem freigeschalteten Njora-Konto an.</p>
      </div>
      <form onSubmit={submit} className={styles.form} aria-busy={loading}>
        <label>E-Mail-Adresse<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /></label>
        <label>Passwort<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={10} maxLength={72} /></label>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <button type="submit" disabled={loading}>{loading ? "Anmeldung wird geprüft …" : "Sicher anmelden"}<span>→</span></button>
      </form>
      <a className={styles.back} href="/">Zur Njora-App ↗</a>
    </section>
    <aside className={styles.loginVisual} aria-hidden="true"><span>Privacy by Design</span><strong>Nur sehen,<br />was nötig ist.</strong><div><i /><i /><i /></div><p>Keine Klarnamen.<br />Keine Finanzinhalte.</p></aside>
  </main>;
}
