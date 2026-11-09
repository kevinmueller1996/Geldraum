"use client";

import { Capacitor } from "@capacitor/core";
import Image from "next/image";
import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

export default function InstallAppCard() {
  const [installed, setInstalled] = useState(false);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const markInstalled = () => { setInstalled(true); setShowHelp(false); };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  useEffect(() => {
    if (!showHelp) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowHelp(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    window.setTimeout(() => document.querySelector<HTMLElement>(".install-dialog .dialog-close")?.focus(), 20);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showHelp]);

  if (Capacitor.isNativePlatform()) return null;

  async function install() {
    if (!prompt) {
      setShowHelp(true);
      return;
    }
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setPrompt(null);
  }

  return <>
    <button className={`install-card ${installed ? "installed" : ""}`} type="button" onClick={install} disabled={installed}>
      <span className="install-icon" aria-hidden="true">{installed ? "✓" : "⇧"}</span>
      <span><strong>{installed ? "Njora ist als App installiert" : "Als App auf dem iPhone"}</strong><small>{installed ? "Du öffnest Njora direkt vom Home-Bildschirm – ohne Browserleiste." : "Mit eigenem Icon, Vollbildmodus und schnellerem Start vom Home-Bildschirm."}</small></span>
      {!installed && <b aria-hidden="true">›</b>}
    </button>

    {showHelp && <div className="modal-backdrop install-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowHelp(false); }}>
      <section className="install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <button className="dialog-close" type="button" aria-label="Schließen" onClick={() => setShowHelp(false)}>×</button>
        <Image src="/njora-mark.png" alt="" width={58} height={58} />
        <p className="eyebrow">Njora für iPhone</p>
        <h2 id="install-title">In drei Schritten auf deinem Home-Bildschirm.</h2>
        <ol>
          <li><span>1</span><div><strong>In Safari öffnen</strong><small>Diese Seite muss in Safari geöffnet sein.</small></div></li>
          <li><span>2</span><div><strong>Teilen antippen</strong><small>Das Quadrat mit dem Pfeil nach oben.</small></div></li>
          <li><span>3</span><div><strong>„Zum Home-Bildschirm“ wählen</strong><small>„Als Web-App öffnen“ aktivieren und hinzufügen.</small></div></li>
        </ol>
        <button className="primary-button" type="button" onClick={() => setShowHelp(false)}>Verstanden</button>
      </section>
    </div>}
  </>;
}
