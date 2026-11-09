import type { CapacitorConfig } from "@capacitor/cli";

const njoraOrigin = process.env.NJORA_IOS_SERVER_URL ?? "https://njora.de";

const config: CapacitorConfig = {
  appId: "de.njora.finanzueberblick",
  appName: "Njora",
  webDir: "capacitor-web",
  backgroundColor: "#f5f0e8",
  server: {
    url: njoraOrigin,
    cleartext: false,
    errorPath: "offline.html",
  },
  ios: {
    appendUserAgent: " Njora-iOS/1.0",
    backgroundColor: "#f5f0e8",
    contentInset: "always",
    preferredContentMode: "mobile",
    allowsLinkPreview: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      launchAutoHide: true,
      backgroundColor: "#f5f0e8",
      showSpinner: false,
      launchFadeOutDuration: 250,
    },
    LocalNotifications: {
      smallIcon: "ic_stat_njora",
    },
  },
};

export default config;
