import type { ReactNode } from "react";
import LegalLinks from "./legal-links";

export default function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="legal-page">
      <a className="brand-lockup" href="/" aria-label="Zu Njora">
        <img className="brand-mark" src="/njora-mark.png" width="42" height="42" alt="" />
        <img className="brand-wordmark" src="/njora-wordmark.png" width="112" height="35" alt="Njora" />
      </a>
      <article>
        <h1>{title}</h1>
        {children}
      </article>
      <LegalLinks />
    </main>
  );
}
