"use client";

import { useEffect } from "react";
import { useState } from "react";

export default function PwaRegistration() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const enableOffline = () => {
      if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    };
    if (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone) enableOffline();
    window.addEventListener("appinstalled", enableOffline);

    return () => {
      window.removeEventListener("appinstalled", enableOffline);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (online) return null;
  return <div className="offline-banner" role="status"><span aria-hidden="true">●</span> Njora ist offline. Änderungen sind wieder möglich, sobald die Verbindung zurück ist.</div>;
}
