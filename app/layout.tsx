import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./ios.css";
import NativeAppBridge from "./native-app-bridge";
import PwaRegistration from "./pwa-registration";

export function generateMetadata(): Metadata {
  const socialImage = "https://njora.de/og.png";

  return {
    title: "Njora – Verstehe, was war. Gestalte, was kommt.",
    description: "Dein persönlicher Finanzüberblick für Konten, Monatsbudget, Kredite, Ziele, Depot und Ersparnisse.",
    manifest: "/manifest.webmanifest",
    applicationName: "Njora",
    formatDetection: { telephone: false },
    appleWebApp: { capable: true, title: "Njora", statusBarStyle: "default" },
    icons: { icon: "/favicon.png", shortcut: "/favicon.png", apple: "/apple-touch-icon.png" },
    openGraph: {
      title: "Njora",
      description: "Verstehe, was war. Gestalte, was kommt.",
      images: [{ url: socialImage, width: 1200, height: 630, alt: "Njora – persönlicher Finanzüberblick" }],
    },
    twitter: { card: "summary_large_image", title: "Njora", description: "Verstehe, was war. Gestalte, was kommt.", images: [socialImage] },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5f0e8",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const userAgent = (await headers()).get("user-agent") ?? "";
  return <html lang="de" className={userAgent.includes("Njora-iOS/") ? "native-app" : undefined}><body>{children}<NativeAppBridge /><PwaRegistration /></body></html>;
}
