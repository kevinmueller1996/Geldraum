import type { Metadata } from "next";
import LegalPage from "../legal-page";

export const metadata: Metadata = { title: "Impressum · Njora" };

export default function Impressum() {
  return (
    <LegalPage title="Impressum">
      <p>Angaben gemäß § 5 DDG</p>
      <address>Kevin Müller · Rheinland Solutions<br />Spitzwegstraße 23A<br />42719 Solingen<br />Deutschland</address>
      <p>Wirtschafts-Identifikationsnummer: DE459117978</p>
      <h2>Kontakt</h2>
      <p><a href="mailto:info@rheinland-solutions.de">info@rheinland-solutions.de</a></p>
      <h2>Verbraucherstreitbeilegung</h2>
      <p>Rheinland Solutions ist weder bereit noch verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
    </LegalPage>
  );
}
