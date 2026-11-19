import type { Metadata } from "next";
import type { ReactNode } from "react";

const title = "Njora – Dein Finanzplan für Fixkosten, Sparziele und Monatsbudget";
const description = "Plane Einkommen, Fixkosten und Kredite ohne Bankanbindung. Njora zeigt deinen monatlichen Spielraum und schätzt, was am Monatsende bleibt.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "https://njora.de/login" },
  openGraph: { title, description, url: "https://njora.de/login", images: ["https://njora.de/og.png"], locale: "de_DE" },
  twitter: { card: "summary_large_image", title, description, images: ["https://njora.de/og.png"] },
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
