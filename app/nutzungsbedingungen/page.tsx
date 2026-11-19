import type { Metadata } from "next";
import LegalPage from "../legal-page";

export const metadata: Metadata = { title: "AGB und Nutzungsbedingungen · Njora" };

export default function Terms() {
  return (
    <LegalPage title="Allgemeine Geschäftsbedingungen">
      <p>Stand: 18. November 2026 · Nutzungsbedingungen für njora.de und die Njora-App.</p>
      <h2>1. Anbieter und Leistung</h2>
      <p>Kevin Müller, handelnd unter Rheinland Solutions, Spitzwegstraße 23A, 42719 Solingen, stellt Njora für die persönliche Budgetplanung bereit. Das Anlegen des Kontos ist kostenlos. Ein Monatsabo beginnt erst, wenn du den Kauf gesondert bestätigst. Mit dem Abo kannst du deinen Finanzplan anlegen, bearbeiten und zwischen Geräten synchronisieren. Preis, Probezeit und Kündigung findest du in Abschnitt 4.</p>
      <h2>2. Registrierung und Zugang</h2>
      <p>Gib eine E-Mail-Adresse an, auf die du Zugriff hast. Über den einmaligen Link bestätigst du die Adresse und legst dein Passwort fest. Mit der Freischaltung deines bestätigten Kontos kommt der Nutzungsvertrag zustande. Schütze dein Passwort und fordere bei Verlust über die Anmeldung einen neuen Link an.</p>
      <h2>3. Beträge und Prognosen</h2>
      <p>Njora rechnet mit deinen Eingaben. Der Depotwert ergibt sich aus Stückzahl und dem zuletzt verfügbaren Euro-Schlusskurs von Cboe Europe oder deinem manuell eingetragenen Kurs je Stück. Der Datenstand bezeichnet den Stand der Kursdatei. Bei ausbleibendem Handel kann der Preis älter sein. Für die Monatsendprognose sind der eingegebene Kontostand, die Fälligkeiten und offene Buchungen maßgeblich. Tatsächliche Beträge können abweichen. Njora bietet keine Anlageberatung, führt keine Zahlungen aus und erteilt keine Handelsaufträge.</p>
      <h2>4. Preis, Probezeit und Kündigung</h2>
      <p>Das Njora-Monatsabo beginnt mit der Kaufbestätigung bei Stripe oder Apple. Im Web kostet es 0,99 € pro Monat einschließlich anfallender Steuern. Beim ersten berechtigten Web-Abschluss sind die ersten 30 Tage kostenlos. Bei Apple gilt für berechtigte Neukunden ein kostenloser Kalendermonat. Der App Store zeigt den Preis in deiner Landeswährung vor der Bestätigung an.</p>
      <p>Wenn du während der Probezeit nicht rechtzeitig kündigst, wird anschließend der beim Abschluss angezeigte Monatspreis berechnet. Ohne Probezeit wird der erste Monatsbetrag direkt bei Abschluss fällig. Die Abrechnung erfolgt danach monatlich, bis du kündigst. Dein Web-Abo kannst du vor der nächsten Abrechnung im Konto oder über <a href="/kuendigen">Verträge hier kündigen</a> beenden. Dein Apple-Abo verwaltest du unter <a href="https://apps.apple.com/account/subscriptions">Apple-Abonnements</a>. Apple empfiehlt, eine kostenlose Probephase mindestens 24 Stunden vor Ablauf zu kündigen.</p>
      <p>Du kannst dein Njora-Konto in den Kontoeinstellungen löschen. Bei einem Apple-Abo kündige zusätzlich bei Apple, damit die Abrechnung endet. Exportiere zuvor die Daten, die du behalten möchtest. Durch bloßes Entfernen der App vom Gerät bleibt das Konto bestehen. Bei Schwierigkeiten erreichst du uns unter <a href="mailto:info@rheinland-solutions.de">info@rheinland-solutions.de</a>.</p>
      <h2>5. Gesetzliche Rechte und Streitbeilegung</h2>
      <p>Für Mängel und Haftung gelten die gesetzlichen Vorschriften. Rheinland Solutions ist weder bereit noch verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
      <p>Wie wir mit deinen Daten umgehen, erläutert die <a href="/datenschutz">Datenschutzerklärung</a>.</p>
    </LegalPage>
  );
}
