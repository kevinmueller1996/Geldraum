# Njora

Njora ist eine persönliche Finanz-App für Kontostände, Monatsplanung, Kredite,
Ziele und Ersparnisse. Die Anwendung läuft mit vinext auf Cloudflare Workers
und speichert Accounts sowie Finanzpläne in D1.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
cp .openai/hosting.example.json .openai/hosting.json
npm test
npm run dev
```

Die echte `.openai/hosting.json` bleibt lokal und wird nicht in GitHub
gespeichert. Ohne diese Datei verwendet die Entwicklung automatisch die
neutrale D1-Bindung `DB`.

## Projektstruktur

- `app/` enthält Oberfläche, Login und API-Routen.
- `db/` und `drizzle/` enthalten das Schema und die Migrationen.
- `public/` enthält PWA-Dateien und die Njora-Markenassets.
- `ios/` enthält das mit Capacitor erzeugte Xcode-Projekt.
- `ios/App/App.xcodeproj` öffnet die native iOS-App in Xcode.
- `.openai/hosting.example.json` ist die neutrale lokale Vorlage.

## iOS und TestFlight

Die iPhone-App verwendet SwiftUI und Swift Charts. Die Oberfläche und die
Bedienlogik liegen im App-Paket. Mit der Njora-Schnittstelle auf `njora.de`
teilt sich die App bestehende Nutzerkonten und Finanzpläne mit der Web-App.
Die App verwahrt ihre Sitzung im iOS-Schlüsselbund.

Öffnen mit `npm run ios:open` oder direkt über `ios/App/App.xcodeproj`.
Schema: `App`. Ziel: iOS 16 oder neuer. Die Bundle-ID
`de.njora.finanzueberblick` bleibt für den bestehenden App-Store-Eintrag gleich.

E-Mail-Bestätigungen und Passwort-Resets funktionieren in der App über
„Link aus E-Mail öffnen“ und durch Einfügen des vollständigen Links.
Automatische Weiterleitung aus Mail ist eine optionale spätere Ergänzung.

Zum Prüfen in Xcode: Anmeldung mit einem Testkonto, Monatsplan bearbeiten,
auf der Website gegenprüfen und den Plan in der App neu laden. Wertpapiersuche,
Kursabruf, Sicherungen in Dateien und lokale Erinnerungen separat testen.
Ein Debug-Build kann mit `-njora-demo` ohne Login starten. Dabei werden
keine echten Konten oder Finanzpläne verwendet.

Vor TestFlight den iPhone-Build archivieren und in App Store Connect prüfen,
dass der Build ohne Web-Oberfläche im bestehenden Njora-Eintrag erscheint.

## Njora E-Mail-/Passwort-Login

Njora verwendet eine eigene D1-Authentifizierung statt eines externen
Identity-Providers:

- Passwörter werden als gesalzene bcrypt-Hashes mit Work-Factor 11 gespeichert;
- Sitzungen und E-Mail-Aktionstokens sind zufällig, in D1 liegt nur ihr Hash;
- der Browser erhält ein `HttpOnly`-, `SameSite`- und in Produktion
  `Secure`-Cookie mit `__Host-`-Präfix;
- wiederholte falsche Logins werden zeitweise gesperrt;
- Bestätigungslinks sind 24 Stunden, Reset-Links 30 Minuten gültig und nur
  einmal nutzbar;
- beim Löschen eines Accounts werden Zugangsdaten, Sitzungen,
  Aktivitätsmetadaten und Finanzplan entfernt.

Die normalisierte E-Mail-Adresse wird für Anmeldung, Verifikation und
Passwort-Reset gespeichert. In der Admin-Ansicht wird weiterhin nur die
maskierte beziehungsweise pseudonymisierte Darstellung ausgegeben.

Existing plans remain attached when a previous tester registers with the same
email address, because the deterministic user id is unchanged.

### E-Mail-Verifizierung aktivieren

Der Versand erfolgt über die Resend-HTTP-API. Diese Werte müssen im
Cloudflare-Backend als Secrets beziehungsweise Environment Variables gesetzt
werden, da Vercel die Account-Routen derzeit dorthin weiterleitet:

- `RESEND_API_KEY`
- `AUTH_EMAIL_FROM`, zum Beispiel `Njora <konto@njora.de>`
- `AUTH_PUBLIC_ORIGIN=https://njora.vercel.app`
- `AUTH_REQUIRE_EMAIL_VERIFICATION=1`

Vor dem Aktivieren müssen Absenderdomain, SPF, DKIM und DMARC eingerichtet
sein. Ohne vollständig konfigurierten Versand lehnt Njora neue Registrierungen
bei aktivierter Verifizierung bewusst ab, statt unbestätigte Konten
freizuschalten. Die Vorlage `.env.example` enthält keine Secrets.

## Deployment auf Vercel

Vercel verwendet über `vercel.json` den nativen Next.js-Build und erzeugt die
erwartete `.next`-Ausgabe. Wenn keine D1-Zugangsdaten im Vercel-Projekt gesetzt
sind, leitet die Anwendung Account- und Admin-Anfragen automatisch serverseitig
an das bestehende Cloudflare-Backend weiter. Dadurch bleiben Registrierung,
Login und vorhandene Accounts ohne zusätzliche Secrets erreichbar.

Für einen späteren direkten Zugriff auf die Cloudflare D1 Query API können
folgende Environment Variables in Vercel gesetzt werden:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `CLOUDFLARE_D1_API_TOKEN` mit D1 Read und D1 Write
- `GELDRAUM_ADMIN_TOKEN` und `GELDRAUM_ADMIN_USER_ID`, falls die Admin-App
  weiterhin auf diese Instanz zugreifen soll

Die Werte gehören ausschließlich in die Vercel-Projekteinstellungen und
dürfen nicht in GitHub committed werden.

Wenn Vercel weiterhin über das Cloudflare-Backend arbeitet, muss zusätzlich
`GELDRAUM_BACKEND_ORIGIN` explizit auf dessen HTTPS-Origin zeigen. Ohne diesen
Wert oder ohne eine vollständige direkte D1-Konfiguration schlagen API-Aufrufe
bewusst geschlossen fehl; es gibt keinen stillen Produktions-Fallback.

## Befehle

- `npm run dev`: lokale Entwicklung starten
- `npm run build`: Produktions-Build prüfen
- `npm test`: Build und Integrationsprüfungen ausführen
- `npm run db:generate`: Migrationen nach Schemaänderungen erzeugen
- `npm run ios:sync`: Web- und Plugin-Konfiguration ins Xcode-Projekt übernehmen
- `npm run ios:open`: das Njora-Projekt in Xcode öffnen
- `npm run ios:run`: Njora im Simulator oder auf einem verbundenen iPhone starten

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
