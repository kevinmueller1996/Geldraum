"use client";
import { useState } from "react";

export type BillingStatus = {active:boolean; provider:"apple"|"stripe"|null; webTrialEligible:boolean; stripeCustomer:boolean};

export default function BillingOffer({billing, standalone = false}:{billing:BillingStatus; standalone?:boolean}) {
  const Heading = standalone ? "h1" : "h2";
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  async function open(action:"checkout"|"portal") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/billing", {
        method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({action}),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json() as {url?: string; error?: string};
      if (!response.ok || !data.url) {
        setError(data.error || "Die Abrechnung ist gerade nicht erreichbar.");
        setBusy(false);
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError("Die Abrechnung ist gerade nicht erreichbar. Bitte prüfe deine Verbindung und versuche es erneut.");
      setBusy(false);
    }
  }
  return <section>
    <Heading>{billing.active ? "Dein Njora-Abo" : "Njora abonnieren"}</Heading>
    {billing.active ? <p>Dein Zugang ist aktiv.</p> : <>
      <p>{billing.webTrialEligible ? "Die ersten 30 Tage sind kostenlos. Danach zahlst du 0,99 € pro Monat." : "Njora kostet 0,99 € pro Monat."} Dein Abo verlängert sich monatlich, bis du kündigst.</p>
      <p><a href="/nutzungsbedingungen">AGB</a> · <a href="/datenschutz">Datenschutz</a></p>
      <button className="auth-button" disabled={busy} onClick={()=>open("checkout")}>{billing.webTrialEligible ? "30 Tage kostenlos testen" : "Zum Monatsabo"}</button>
    </>}
    {billing.provider==="apple" && <a href="https://apps.apple.com/account/subscriptions">Apple-Abonnement verwalten</a>}
    {billing.stripeCustomer && <button className="text-action" disabled={busy} onClick={()=>open("portal")}>Web-Abo verwalten oder kündigen</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
