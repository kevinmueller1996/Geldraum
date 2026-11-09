"use client";

import { useMemo, useState } from "react";
import type { AdminData } from "./admin-data";
import { AdminBrand } from "./Brand";
import styles from "./admin.module.css";

function dateTime(value: string) {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(value));
}

export function AdminDashboard({ data }: { data: AdminData }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const filtered = useMemo(() => data.testers.filter((tester) => {
    const matches = `${tester.testerCode} ${tester.emailMask}`.toLowerCase().includes(query.trim().toLowerCase());
    if (!matches) return false;
    if (filter === "active") return Date.parse(data.generatedAt) - Date.parse(tester.lastSeenAt) <= 604_800_000;
    if (filter === "with-plan") return tester.hasPlan;
    if (filter === "without-plan") return !tester.hasPlan;
    return true;
  }), [data, filter, query]);

  async function signOut() {
    await fetch("/api/admin/session/logout", { method: "POST" });
    window.location.reload();
  }

  return <main className={styles.shell}>
    <header className={styles.topbar}><a href="/admin" aria-label="Njora Admin Startseite"><AdminBrand /></a><div><span className={styles.live}>● Live verbunden</span><button type="button" onClick={() => window.location.assign("/api/admin/backup")}>Datenbank sichern</button><button type="button" onClick={() => window.location.reload()}>Aktualisieren</button><button type="button" onClick={signOut}>Abmelden</button></div></header>
    <section className={styles.hero}><div><p className={styles.eyebrow}>Testphase · Datenschutzansicht</p><h1>Tester im Blick.<br /><em>Daten im Schutz.</em></h1><p>Pseudonymisierte Nutzung und Aktivität – ohne Klarnamen, vollständige E-Mail-Adressen oder Finanzinhalte.</p></div><aside><b>✓</b><span><strong>Privacy by Design</strong><small>Nur notwendige Testmetadaten</small></span></aside></section>
    <section className={styles.stats} aria-label="Testerkennzahlen"><article><span>Tester gesamt</span><strong>{data.summary.total}</strong><small>pseudonymisierte Konten</small></article><article><span>Heute aktiv</span><strong>{data.summary.active24h}</strong><small>letzte 24 Stunden</small></article><article><span>Aktiv diese Woche</span><strong>{data.summary.active7d}</strong><small>letzte 7 Tage</small></article><article><span>Plan angelegt</span><strong>{data.summary.withPlan}</strong><small>nur Status, keine Inhalte</small></article></section>
    <section className={styles.workspace}><header><div><p className={styles.eyebrow}>Kontenübersicht</p><h2>Alle Tester</h2></div><small>Stand {dateTime(data.generatedAt)}</small></header><div className={styles.controls}><input aria-label="Tester suchen" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kennung oder maskierte E-Mail suchen" /><select aria-label="Tester filtern" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Alle Tester</option><option value="active">Aktiv in 7 Tagen</option><option value="with-plan">Mit Finanzplan</option><option value="without-plan">Ohne Finanzplan</option></select></div><div className={styles.tableWrap}><table><thead><tr><th>Tester</th><th>Datenschutzkontakt</th><th>Erstzugriff</th><th>Letzte Aktivität</th><th>Aufrufe</th><th>Finanzplan</th></tr></thead><tbody>{filtered.map((tester) => <tr key={tester.testerCode}><td data-label="Tester"><b>{tester.testerCode}</b></td><td data-label="Kontakt">{tester.emailMask}</td><td data-label="Erstzugriff">{dateTime(tester.firstSeenAt)}</td><td data-label="Letzte Aktivität">{dateTime(tester.lastSeenAt)}</td><td data-label="Aufrufe">{tester.accessCount || "–"}</td><td data-label="Finanzplan"><span className={tester.hasPlan ? styles.ready : styles.open}>{tester.hasPlan ? `Angelegt · Revision ${tester.planRevision}` : "Noch offen"}</span></td></tr>)}</tbody></table>{filtered.length === 0 ? <div className={styles.empty}><strong>Keine passenden Tester gefunden</strong><p>Ändere Suche oder Filter.</p></div> : null}</div></section>
    <footer className={styles.footer}><span>Njora Admin</span><p>Interne Testphasenansicht · Zugriff nur für den Betreiber</p><a href="/">Zur Njora-App ↗</a></footer>
  </main>;
}
