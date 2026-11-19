"use client";
import { useState } from "react";

export type BillingStatus = {active:boolean; provider:"apple"|"stripe"|null; webTrialEligible:boolean; stripeCustomer:boolean};

export default function BillingOffer({billing}:{billing:BillingStatus}) {
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  async function open(action:"checkout"|"portal") {
    setBusy(true); setError("");
    try {
      const response=await fetch("/api/billing",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action})});
      const data=await response.json();
      if(!response.ok || !data.url) throw new Error(data.error || "Die Abrechnung ist gerade nicht erreichbar.");
      window.location.assign(data.url);
    } catch(e) {setError(e instanceof Error ? e.message : "Bitte versuche es erneut.");setBusy(false);}
  }
  return <section>
    <h2>{billing.active ? "Dein Njora-Abo" : "Njora abonnieren"}</h2>
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
