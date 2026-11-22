import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import LegalLinks from "./legal-links";

export default function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="legal-page">
      <Link prefetch={false} className="brand-lockup" href="/" aria-label="Zu Njora">
        <Image unoptimized className="brand-mark" src="/njora-mark-small.webp" width="42" height="42" alt="" />
        <Image unoptimized className="brand-wordmark" src="/njora-wordmark-small.webp" width="112" height="35" alt="Njora" />
      </Link>
      <article>
        <h1>{title}</h1>
        {children}
      </article>
      <LegalLinks />
    </main>
  );
}
