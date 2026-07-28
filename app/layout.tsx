import type { Metadata, Viewport } from "next";
import { DM_Sans, Newsreader } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import PwaRegistration from "./pwa-registration";

const sans = DM_Sans({ variable: "--font-sans", subsets: ["latin"] });
const serif = Newsreader({ variable: "--font-serif", subsets: ["latin"], style: ["normal", "italic"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og.png`;

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
  themeColor: "#f4efe7",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="de"><body className={`${sans.variable} ${serif.variable}`}>{children}<PwaRegistration /></body></html>;
}
