"use client";

import { useEffect } from "react";

export default function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    void navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready).then(registration => {
      const assets = performance.getEntriesByType("resource").map(asset => asset.name);
      registration.active?.postMessage({type:"NJORA_WARM_SHELL", assets});
    }).catch(() => {});
  }, []);
  return null;
}
