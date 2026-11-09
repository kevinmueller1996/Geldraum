import type { Metadata } from "next";
import LegalPage from "../legal-page";

export const metadata: Metadata = { title: "Datenschutz · Njora" };

export default function Privacy() {
  return (
    <LegalPage title="Datenschutz">
      <h2>Verantwortlicher</h2>
      <p>Kevin Müller, Rheinland Solutions, Spitzwegstraße 23A, 42719 Solingen, Deutschland. Kontakt unter <a href="mailto:info@rheinland-solutions.de">info@rheinland-solutions.de</a>.</p>
      <h2>Konto und Finanzplan</h2>
      <p>Für dein Konto speichern wir E-Mail-Adresse, Passwort-Hash, Sitzungs- und Bestätigungsdaten. Deinen Finanzplan speichern wir mit den Angaben, die du selbst einträgst, etwa Kontoständen, Einnahmen, Ausgaben, Krediten, Ersparnissen und Zielen. So stellen wir die App bereit und synchronisieren deinen Plan zwischen deinen Geräten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.</p>
      <h2>Betrieb und Sicherheit</h2>
      <p>Für Auslieferung, Fehleranalyse und Missbrauchsschutz können technische Anfragedaten wie IP-Adresse, Geräteinformationen, Zeitpunkte und Anmeldeversuche verarbeitet werden. Rechtsgrundlage ist unser berechtigtes Interesse am sicheren Betrieb nach Art. 6 Abs. 1 lit. f DSGVO.</p>
      <p>Die Website wird über Vercel bereitgestellt. Backend und Datenbank nutzen ChatGPT Sites von OpenAI und Cloudflare. Für Bestätigungs- und Passwortmails verwenden wir Resend, sobald der Versand eingerichtet ist. Bei der optionalen Wertpapiersuche und Kursabfrage werden Suchbegriffe oder Symbole an Yahoo Finance übermittelt. Njora übermittelt dabei keine Kontostände oder Depotmengen.</p>
      <p>Bei diesen Anbietern kann eine Verarbeitung außerhalb des Europäischen Wirtschaftsraums stattfinden. Dafür gelten, soweit erforderlich, die datenschutzrechtlichen Garantien des jeweiligen Anbieters, etwa EU-Standardvertragsklauseln oder ein anwendbarer Angemessenheitsbeschluss. Du kannst die einschlägigen Informationen bei uns anfragen.</p>
      <h2>Cookies und Speicher auf deinem Gerät</h2>
      <p>Ein technisch notwendiges Sitzungscookie hält dich angemeldet. Die installierbare Web-App speichert Oberflächendateien für ihren Offline-Hinweis. In der iOS-App bleiben deine Einstellungen für Erinnerungen lokal auf dem Gerät. Die Anwendung setzt keine Werbe- oder Analyse-Cookies ein.</p>
      <h2>Speicherdauer und Löschung</h2>
      <p>Kontodaten und Finanzplan bleiben bis zur Löschung deines Kontos gespeichert. Unter „Account“ kannst du deinen Plan exportieren und dein Konto löschen. Abgelaufene Sitzungen werden ungültig, und Bestätigungs- und Reset-Links verlieren spätestens nach 24 Stunden beziehungsweise 30 Minuten ihre Gültigkeit. Betriebs- und Sicherungskopien können für die Dauer ihrer jeweiligen Aufbewahrungsfrist fortbestehen.</p>
      <h2>Deine Rechte</h2>
      <p>Du kannst Auskunft, Berichtigung, Löschung, Einschränkung und Datenübertragbarkeit verlangen sowie einer Verarbeitung auf Grundlage berechtigter Interessen widersprechen, soweit die gesetzlichen Voraussetzungen vorliegen. Du kannst dich außerdem bei einer Datenschutzaufsichtsbehörde beschweren, etwa bei der <a href="https://www.ldi.nrw.de/">Landesbeauftragten für Datenschutz und Informationsfreiheit Nordrhein-Westfalen</a>.</p>
    </LegalPage>
  );
}
