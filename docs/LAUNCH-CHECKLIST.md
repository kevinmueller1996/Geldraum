# Njora Launch-Checkliste

## Vor dem öffentlichen Web-Launch

- Resend-Absenderdomain mit SPF, DKIM und DMARC verifizieren.
- `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_PUBLIC_ORIGIN` setzen und danach
  `AUTH_REQUIRE_EMAIL_VERIFICATION=1` aktivieren.
- Datenschutzerklärung, Impressum, Nutzungsbedingungen und Supportkontakt mit
  den echten Betreiberangaben veröffentlichen.
- Admin-Zugang von einem gemeinsamen Token auf persönliche Admin-Konten mit
  Mehrfaktor-Authentifizierung umstellen.
- Cloudflare WAF/Rate-Limits für Login-, Registrierungs- und E-Mail-Endpunkte
  konfigurieren.
- Backup-, Restore-, Incident- und Löschprozesse mit Testdaten durchspielen.
- Security-Header, Auth-Flows, Accountlöschung und responsive Layouts auf der
  Produktionsdomain als End-to-End-Test prüfen.
- Content-Security-Policy ergänzen und CSRF-/Origin-Prüfungen auch im späteren
  nativen WebView-Kontext testen; fehlende Mail- oder Backend-Konfigurationen
  müssen weiterhin geschlossen fehlschlagen.
- Bestandskonten vor der Aktivierung der E-Mail-Pflicht informieren und den
  Re-Verifizierungsweg testen: bestehende Sitzungen verlieren bis zur
  Bestätigung den Zugriff.
- Datenempfänger und Aufbewahrungs-/Löschfristen für Cloudflare, Vercel,
  Resend und Yahoo vollständig ins Datenschutzinventar aufnehmen.

## Zusätzlich vor einer iOS-App-Store-Einreichung

- Apple-Developer-Konto, Bundle-ID und ein echtes natives iOS-Projekt anlegen;
  die vorhandene PWA allein ist kein App-Store-Build.
- Einen ausreichend nativen Mehrwert gegenüber einer reinen WebView schaffen.
- App-Icon, Launch-Screen, Support-URL, Privacy-URL und App-Store-Metadaten
  finalisieren.
- Demoaccount oder vollwertigen Demomodus, ein während der Prüfung erreichbares
  Backend, Review-Notes und einen Recovery-Kontakt bereitstellen.
- App-Privacy-Angaben für E-Mail/User-ID, Finanzinformationen und
  Produktinteraktionen vollständig erklären.
- `PrivacyInfo.xcprivacy`, ATS, Keychain-Speicherung und Privacy-Manifeste aller
  eingebundenen SDKs prüfen.
- Für das Privacy Label zusätzlich Search History und Diagnostics prüfen;
  Apple behandelt auch eine gehashte E-Mail als E-Mail-Adresse.
- Kontolöschung aus der App sowie der vollständige Login-/Reset-Flow in
  TestFlight testen.
- Die Einordnung als persönlicher Budgetplaner ohne Zahlungsabwicklung,
  Trading oder Anlageberatung vor Einreichung als echtes Gate mit Apple und
  juristisch klären: insbesondere „Money Management“, nötige juristische Person
  und mögliche Lizenzen nach Guideline 3.2.1(viii).
- Auf echten iPhones und iPads mit aktuellem iOS/iPadOS, IPv6-only,
  schwachem/offlinem Netz, Background/Resume, Universal Links, VoiceOver,
  Dynamic Type, Kontrast und Tap-Zielen testen.
- Sign in with Apple ist beim ausschließlich eigenen E-Mail-/Passwort-Login
  derzeit nicht nötig; bei späterem Social Login Guideline 4.8 neu prüfen.
- Falls Capacitor eingesetzt wird, Apples Anforderungen an SDK-Signatur und
  Privacy Manifest ausdrücklich einplanen.
