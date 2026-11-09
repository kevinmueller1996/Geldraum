# Njora iOS – Übergabe und Release-Checkliste

## Bereits umgesetzt

- Capacitor-8-Projekt mit Bundle-ID `de.njora.finanzueberblick`
- finales Njora-App-Icon und gebrandeter Startbildschirm
- sichere HTTPS-Verbindung zur bestehenden Njora-App
- native Teilen-Funktion für vom Nutzer ausgelöste Datensicherungen
- tägliche oder wöchentliche lokale Check-in-Erinnerungen
- iPhone-Safe-Areas, Vollbilddarstellung und Offline-Fehlerseite
- installierbare PWA mit App-Icon und eigenem Offline-Zustand
- keine persönlichen Finanzdaten im Service-Worker-Cache

## Erster interner TestFlight-Build

1. `npm run ios:sync` ausführen.
2. `npm run ios:open` ausführen.
3. In Xcode unter `Signing & Capabilities` das Apple-Developer-Team auswählen.
4. Auf einem echten iPhone Anmeldung, Datensynchronisierung, Erinnerungen und
   Teilen testen.
5. `Product > Archive` wählen und den Build nach App Store Connect hochladen.
6. In TestFlight zunächst interne Tester hinzufügen.

## Vor der öffentlichen App-Store-Einreichung

- eigene Njora-Produktionsdomain statt der bisherigen Projekt-URL verwenden
- mobilen Client in das App-Paket bündeln und Mobile-API mit Keychain-Token
  bereitstellen; die aktuelle Remote-Konfiguration ist nur für interne Tests
- Face ID als lokales Entsperren auf Basis des iOS-Schlüsselbunds ergänzen
- vollständige Datenschutzerklärung mit verantwortlicher Person/Firma und
  Kontaktadresse veröffentlichen und innerhalb der App verlinken
- App-Store-Datenschutzangaben für Accountkennung und Finanzinformationen
  ausfüllen
- Support-URL, Marketing-URL, Beschreibung, Keywords und Screenshots bereitstellen
- Review-Demokonto mit repräsentativen Beispieldaten anlegen
- In-App-Accountlöschung auf einem echten Gerät prüfen
- mindestens einen Offline-, Update- und Sitzungsablauf vollständig testen

## Geplante App-Store-Funktionen

Die native Erinnerung und das iOS-Teilen schaffen bereits sichtbaren Mehrwert.
Für eine robuste öffentliche Version sollten zusätzlich Face ID, ein
verschlüsselter Lesemodus für die zuletzt synchronisierte Übersicht und Deep
Links direkt zum Check-in umgesetzt werden.
