"use client";

import { UiIcon } from "./ui-icon";
import { Capacitor } from "@capacitor/core";
import { useBrowserReady } from "./browser-runtime";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

function installPlatform() {
  const iPadDesktopMode = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) || iPadDesktopMode) return "appleMobile";
  return /Android/i.test(navigator.userAgent) ? "android" : "desktop";
}

export default function InstallAppCard() {
  const ready = useBrowserReady();
  const [installationAccepted, setInstalled] = useState(false);
  const installed = installationAccepted || (ready && isStandalone());
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const platform = ready ? installPlatform() : "desktop";
  const dialog = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
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
      if (event.key !== "Tab") return;
      const buttons = dialog.current?.querySelectorAll("button");
      if (!buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    dialog.current?.querySelector("button")?.focus();
    const opener = trigger.current;
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus({ preventScroll: true });
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showHelp]);

  if (Capacitor.isNativePlatform()) return null;

  async function install() {
    if (!prompt) {
      setShowHelp(true);
      return;
    }
    try {
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === "accepted") setInstalled(true);
    } catch {
      setShowHelp(true);
    }
    setPrompt(null);
  }

  return <>
    <button ref={trigger} className={`install-card ${installed ? "installed" : ""}`} type="button" onClick={install} disabled={installed}>
      <span className="install-icon" aria-hidden="true"><UiIcon name={installed ? "check" : "share"} /></span>
      <span><strong>{installed ? "Njora ist als App installiert" : platform === "appleMobile" ? "Als App auf dem iPhone oder iPad" : "Njora auf diesem Gerät installieren"}</strong><small>{installed ? "Du öffnest Njora direkt vom Home-Bildschirm – ohne Browserleiste." : "Mit eigenem Icon, Vollbildmodus und schnellerem Start vom Home-Bildschirm."}</small></span>
      {!installed && <b aria-hidden="true"><UiIcon name="next" /></b>}
    </button>

    {showHelp && <div className="modal-backdrop install-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowHelp(false); }}>
      <section ref={dialog} className="install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <button className="dialog-close" type="button" aria-label="Schließen" onClick={() => setShowHelp(false)}>×</button>
        <Image src="/njora-mark-small.webp" alt="" width={58} height={58} />
        {platform === "appleMobile" ? <>
        <p className="eyebrow">Njora für iPhone und iPad</p>
        <h2 id="install-title">In drei Schritten auf deinem Home-Bildschirm.</h2>
        <ol>
          <li><span>1</span><div><strong>In Safari öffnen</strong><small>Diese Seite muss in Safari geöffnet sein.</small></div></li>
          <li><span>2</span><div><strong>Teilen antippen</strong><small>Das Quadrat mit dem Pfeil nach oben.</small></div></li>
          <li><span>3</span><div><strong>„Zum Home-Bildschirm“ wählen</strong><small>„Als Web-App öffnen“ aktivieren und hinzufügen.</small></div></li>
        </ol>
        </> : <>
          <h2 id="install-title">Njora auf diesem Gerät öffnen</h2>
          <p>{platform === "android"
            ? "Öffne das Browsermenü und wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“, sofern dein Browser diese Option anbietet."
            : "Wenn dein Browser die Installation unterstützt, findest du die Option in der Adressleiste oder im Browsermenü. Du kannst Njora auch als Lesezeichen speichern."}</p>
        </>}
        <button className="primary-button" type="button" onClick={() => setShowHelp(false)}>Verstanden</button>
      </section>
    </div>}
  </>;
}
