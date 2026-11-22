# Njora für iPhone und iPad freigeben

## Projekt und Build

1. In Xcode `ios/App/App.xcodeproj` öffnen und das Schema `App` wählen. SwiftUI, WidgetKit und StoreKit gehören zum nativen Projekt. Die Webanwendung wird separat gebaut.
2. Vor dem Archivieren Bundle-IDs, App Group, Signing, Version und übereinstimmende Buildnummern von App und Widget-Erweiterung prüfen. Ein neuer Upload benötigt eine höhere Buildnummer.
3. Einen Release-Build für iOS archivieren und validieren. Die Widget-Erweiterung muss unter `PlugIns` im App-Paket liegen.

## Auf Geräten prüfen

- Anmeldung, Bestätigungslink, Passwort-Reset, Export und Import mit einem Testkonto vollständig durchgehen.
- Einen Finanzplan offline ändern, die App neu starten und mit der Cloud abgleichen. Einen historischen Check-in ändern und danach den aktuellen Kontostand vergleichen.
- iPhone im Hochformat sowie iPad im Hoch- und Querformat prüfen. Mit größerer Schrift Dashboard, Listen, Formulare und Dialoge öffnen.
- Beide Widgets in kleiner und mittlerer Größe prüfen. Einen Check-in speichern, das Datum des Widgets kontrollieren und nach Abmeldung prüfen, dass die Beträge verschwinden.
- Einen TestFlight-Kauf bestätigen und wiederherstellen. Danach Abo-Zuordnung und Kündigungshinweis prüfen. Für eine frühere eingereichte Version bleiben die dazugehörigen Aufnahmen und Testergebnisse der Bezugspunkt.

## App Store Connect

Build und Abo der gewünschten Version zuordnen. Preis, Probezeit, lokalisierte Metadaten, Screenshots für beide Geräteklassen, erreichbare Support- und Datenschutz-URLs sowie die Angaben zum Review-Konto kontrollieren. Den privaten Prüfanhang mit der Bedienung auf einem echten Gerät abspielen. Den tatsächlichen Einreichungsstatus nach dem Senden im Bereich App Review nachlesen.
