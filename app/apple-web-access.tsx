"use client";

import { type FormEvent, useEffect, useState } from "react";
import Image from "next/image";

export default function AppleWebAccess({purpose, destination = "/", disabled = false}: {
  purpose: "login" | "register" | "link";
  destination?: string;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<{web: boolean; linked: boolean}>();
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/apple", {cache: "no-store", signal: controller.signal})
      .then(async response => { if (response.ok && !controller.signal.aborted) setStatus(await response.json()); })
      .catch(() => { /* Password access is independent of Apple availability. */ });
    return () => controller.abort();
  }, []);

  if (!status?.web) return null;
  if (purpose === "link" && status.linked) return <div>
    <p>Apple-Konto verbunden</p>
    <InvitationEmail />
  </div>;
  return <form method="post" action="/api/auth/apple/start">
    <input type="hidden" name="purpose" value={purpose} />
    <input type="hidden" name="continue" value={destination} />
    {purpose === "link" && <p>Apple-Konto verbinden</p>}
    <button type="submit" disabled={disabled} className="apple-auth-button" aria-label={purpose === "link" ? "Mit Apple anmelden und Apple-Konto verbinden" : "Mit Apple anmelden"}>
      <Image unoptimized src="/njora-apple-signin.png" width={270} height={44} alt="" />
    </button>
  </form>;
}

function InvitationEmail() {
  const [verified, setVerified] = useState<string | null | undefined>();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/alias", {cache: "no-store", signal: controller.signal})
      .then(async response => { if (response.ok) setVerified((await response.json()).email ?? null); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/alias", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(sent ? {action: "verify", code: code.trim()} : {action: "send", email}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Die Anfrage konnte nicht abgeschlossen werden.");
      if (sent) setVerified(result.email);
      else {
        setSent(true);
        setNotice(result.message);
      }
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "Error" ? cause.message : "Bitte versuche es erneut.");
    } finally { setBusy(false); }
  }

  if (verified === undefined) return null;
  if (verified) return <p>Weitere E-Mail für Einladungen: <strong>{verified}</strong></p>;
  return <details>
    <summary>Weitere E-Mail für Einladungen</summary>
    <p>Wenn du deine E-Mail bei Apple verborgen hast, kannst du hier die Adresse bestätigen, an die du Einladungen erhalten möchtest.</p>
    <form className="login-form" onSubmit={submit}>
      {sent
        ? <label>Bestätigungscode<input required autoComplete="one-time-code" maxLength={16} value={code} onChange={event => setCode(event.target.value)} /></label>
        : <label>E-Mail-Adresse<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{sent ? "E-Mail bestätigen" : "Code senden"}</button>
      {sent && <button type="button" disabled={busy} onClick={() => { setSent(false); setCode(""); setNotice(""); setError(""); }}>E-Mail ändern</button>}
    </form>
  </details>;
}
