import type { Metadata } from "next";
import LegalPage from "../legal-page";

export const metadata: Metadata = { title: "Impressum · Njora" };

export default function Impressum() {
  return (
    <LegalPage title="Impressum">
      <p>Angaben gemäß § 5 DDG</p>
      <address>Kevin Müller · Rheinland Solutions<br />Spitzwegstraße 23A<br />42719 Solingen<br />Deutschland</address>
      <h2>Kontakt</h2>
      <p><a href="mailto:info@rheinland-solutions.de">info@rheinland-solutions.de</a></p>
    </LegalPage>
  );
}
