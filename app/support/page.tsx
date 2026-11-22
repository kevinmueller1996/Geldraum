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
      <p>Im Web öffnest du „Mehr“ oder das Profilsymbol oben rechts. Dort findest du „Daten exportieren“ und „Account und Finanzdaten löschen“. Wenn du das Abo-Angebot siehst, gelangst du über „Konto, Datenexport und Löschung“ dorthin. Auf dem iPhone oder iPad öffnest du über das Profilsymbol „Konto &amp; Einstellungen“. Wenn du eine Kopie behalten möchtest, exportiere den Plan vor der Löschung.</p>
      <p>Bei einer Kontolöschung endet ein Web-Abo sofort. Ein App-Store-Abo wird weiter über Apple abgerechnet. Kündige es vorher in deinen <a href="https://apps.apple.com/account/subscriptions">Apple-Abonnements</a>, auch während der Probezeit.</p>
      <p>Für eine Fehlermeldung genügen die App-Version, dein Gerät und eine kurze Beschreibung. Lass Passwörter und Finanzbeträge in deiner Nachricht weg.</p>
    </LegalPage>
  );
}
