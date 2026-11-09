import type { Metadata } from "next";
import LegalPage from "../legal-page";

export const metadata: Metadata = { title: "Support · Njora" };

export default function Support() {
  return (
    <LegalPage title="Hilfe zu Njora">
      <p>Bei Fragen zum Konto oder zur App erreichst du uns unter <a href="mailto:info@rheinland-solutions.de?subject=Njora%20Support">info@rheinland-solutions.de</a>.</p>
      <h2>Anmeldung und Passwort</h2>
      <p>Trage deine E-Mail-Adresse auf der <a href="/login">Anmeldeseite</a> ein und wähle „Passwort vergessen?“. Prüfe auch deinen Spam-Ordner. Bestätigungs- und Reset-Links lassen sich jeweils einmal verwenden.</p>
      <h2>Export und Löschung</h2>
      <p>Unter „Account“ kannst du deinen Finanzplan exportieren oder dein Konto und die zugehörigen Daten löschen.</p>
      <p>Für eine Fehlermeldung genügen die App-Version, dein Gerät und eine kurze Beschreibung. Lass Passwörter und Finanzbeträge in deiner Nachricht weg.</p>
    </LegalPage>
  );
}
