# Njora vor einer öffentlichen Freigabe prüfen

## Web und Backend

- Produktionsdomain, Anmeldung, Support, Datenschutz, AGB und Kündigungsseite über njora.de aufrufen. Die Web-Oberfläche auf Vercel und das Sites-Backend mit D1 haben getrennte Deployments.
- Den Resend-Absender und die Zustellung von Registrierung und Passwort-Reset mit einem eigenen Postfach prüfen. Bestätigte Bestandskonten und ausstehende Verifizierungen separat testen.
- Konto anlegen, Plan bearbeiten, offline speichern, erneut verbinden und mit einem zweiten Client vergleichen. Kontolöschung und erneut verwendete E-Mail-Adressen mit Testdaten prüfen.
- Mit einer isolierten Datenbank einen Backup-Export wiederherstellen. Die Zuordnung der Abos kontrollieren. Der Restore startet mit neu anzulegenden Sitzungen.
- Veröffentlichung des Kaufangebots separat steuern. Berechtigung, Probephase, Rückkehr vom Checkout, Kündigung und Ausfall eines Zahlungsanbieters mit Testzugängen prüfen.

## Betrieb und Datenschutz

- Personenbezogenen Betreiberzugang und Schutz des Administrationsbereichs einschließlich Mehrfaktor-Authentifizierung auf der Hostingseite prüfen. Rate-Limits, Warnungen für Störungen und Ablauf bei einem Vorfall mit den für den Betrieb Verantwortlichen durchgehen.
- Datenempfänger, Aufbewahrung, Backup-Rotation und Löschung mit den tatsächlichen Einstellungen bei Vercel, Sites, Cloudflare, Resend und den Zahlungsanbietern abgleichen. Die Datenschutzangaben im Store nach Änderungen an erhobenen Daten aktualisieren.

## iPhone, iPad und App Review

- App und Widget-Scheme im vorhandenen SwiftUI-Projekt bauen. Die Release-Schritte stehen in [iOS-Freigabe](ios-release-checklist.md).
- Vor dem Senden im Eintrag der konkreten Version Build, Monatsabo und dessen Prüfstatus kontrollieren. Review-Zugang, Bedienelemente, Datenschutzangaben und Supportkontakt mit dem tatsächlichen Build vergleichen.
- Für App Review die Aufnahme vom echten iPhone im Prüfanhang öffnen und abspielen. Store-Screenshots und eine öffentliche App-Vorschau werden separat verwaltet.
- Zusätzlich VoiceOver, Dynamic Type, IPv6, schwaches Netz und Rückkehr aus dem Hintergrund testen. Bei neuen Finanzfunktionen die Einordnung des Produkts und die geltenden Store-Anforderungen erneut prüfen.
- In TestFlight ein Sandbox-Abo erwerben und wiederherstellen. Prüfen, ob die Freischaltung im richtigen Njora-Konto erscheint. Für die Prüfung ausschließlich Beispieldaten verwenden.
