"use client";
import { useState, type FormEvent } from "react";
import LegalPage from "../legal-page";

export default function Cancellation() {
  const [special, setSpecial] = useState(false);
  const [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    setPending(true);
    setNotice("");
    try {
      const res = await fetch("/api/kuendigung", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Bitte versuche es erneut.");
      setReceipt(result.receipt);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Der Eingang konnte nicht bestätigt werden.");
    } finally {
      setPending(false);
    }
  }
  return <LegalPage title="Web-Abo kündigen">
    {receipt ? <>
      <h2>Deine Kündigung ist eingegangen</h2>
      <p style={{whiteSpace:"pre-wrap"}}>{receipt}</p>
      <button type="button" onClick={() => window.print()}>Bestätigung drucken oder als PDF sichern</button>
    </> : <>
      <p>Hier kannst du dein Njora-Monatsabo aus dem Web kündigen. Abos aus dem App Store verwaltest du bei <a href="https://apps.apple.com/account/subscriptions">Apple</a>.</p>
      <form onSubmit={submit} className="auth-form">
        <label>Vor- und Nachname<input name="name" autoComplete="name" required maxLength={120} /></label>
        <label>E-Mail des Njora-Kontos<input name="email" type="email" required maxLength={254} /></label>
        <label>E-Mail für die Bestätigung, falls abweichend<input name="reply" type="email" maxLength={254} /></label>
        <label>Finanzbereich<select name="contract" required defaultValue=""><option value="" disabled>Bitte auswählen</option><option>Njora Privat</option><option>Njora Business</option></select></label>
        <label>Art der Kündigung<select name="kind" value={special ? "extraordinary" : "ordinary"} onChange={e=>setSpecial(e.target.value==="extraordinary")}>
          <option value="ordinary">Ordentliche Kündigung</option><option value="extraordinary">Außerordentliche Kündigung</option>
        </select></label>
        {special && <label>Kündigungsgrund<textarea name="reason" maxLength={800} /></label>}
        <label>Gewünschter Endtermin (optional)<input type="date" name="end" /></label>
        <p>Ohne Datumsangabe kündigst du zum nächstmöglichen Zeitpunkt.</p>
        <button className="auth-button" disabled={pending}>Jetzt kündigen</button>
        {notice && <p role="alert">{notice}</p>}
      </form>
    </>}
  </LegalPage>;
}
