"use client";

import { Capacitor } from "@capacitor/core";
import { useEffect } from "react";

export default function NativeAppBridge() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    document.documentElement.classList.add("native-app");

    void Promise.allSettled([
      import("@capacitor/status-bar").then(({ StatusBar, Style }) => StatusBar.setStyle({ style: Style.Light })),
      import("@capacitor/splash-screen").then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 250 })),
    ]);
  }, []);

  return null;
}
