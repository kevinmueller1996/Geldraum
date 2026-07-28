import type { Metadata, Viewport } from "next";
import { DM_Sans, Newsreader } from "next/font/google";
import "./globals.css";
import PwaRegistration from "./pwa-registration";

const sans = DM_Sans({ variable: "--font-sans", subsets: ["latin"] });
const serif = Newsreader({ variable: "--font-serif", subsets: ["latin"], style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "Geldraum – Heute klar. Morgen frei.",
  description: "Dein persönlicher Finanzüberblick für Konten, Monatsbudget, Kredite, Ziele, Depot und Ersparnisse.",
  manifest: "/manifest.webmanifest",
  applicationName: "Geldraum",
  formatDetection: { telephone: false },
  appleWebApp: { capable: true, title: "Geldraum", statusBarStyle: "default" },
  icons: { icon: "/favicon.png", shortcut: "/favicon.png", apple: "/apple-touch-icon.png" },
  openGraph: {
    title: "Geldraum",
    description: "Heute klar. Morgen frei.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Geldraum – persönlicher Finanzüberblick" }],
  },
  twitter: { card: "summary_large_image", title: "Geldraum", description: "Heute klar. Morgen frei.", images: ["/og.png"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4efe7",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="de"><body className={`${sans.variable} ${serif.variable}`}>{children}<PwaRegistration /></body></html>;
}
