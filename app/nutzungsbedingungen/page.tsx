import type { Metadata } from "next";
import LegalPage from "../legal-page";

export const metadata: Metadata = { title: "Nutzungsbedingungen · Njora" };

export default function Terms() {
  return (
    <LegalPage title="Nutzungsbedingungen">
      <h2>Dienst und Anbieter</h2>
      <p>Njora ist ein Werkzeug von Kevin Müller, Rheinland Solutions, für deine persönliche Budget- und Finanzplanung. Du entscheidest, welche Kontostände, Einnahmen, Ausgaben und Ziele du manuell erfasst.</p>
      <h2>Planwerte und Kurse</h2>
      <p>Prognosen und Beispielrechnungen beruhen auf deinen Angaben. Angezeigte Kurse können verzögert sein. Die Inhalte dienen deiner Orientierung und stellen keine Anlage-, Steuer- oder Rechtsberatung dar.</p>
      <h2>Dein Konto</h2>
      <p>Verwende eine E-Mail-Adresse, auf die du Zugriff hast, und halte dein Passwort geheim. Für den Zugriff auf deine Daten auf mehreren Geräten brauchst du ein Konto und eine Internetverbindung. Du kannst deine Daten exportieren und dein Konto in den Einstellungen löschen.</p>
      <p>Die gesetzlichen Rechte bleiben unberührt. Informationen zur Verarbeitung findest du unter <a href="/datenschutz">Datenschutz</a>.</p>
    </LegalPage>
  );
}
