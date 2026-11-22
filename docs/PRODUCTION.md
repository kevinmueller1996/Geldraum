# Njora Produktion

Die öffentliche Adresse ist https://njora.de. Das Vercel-Projekt "njora" im
Team RheinlandSolutions baut den Hauptbranch von kevinmueller1996/Geldraum.
Daten und Authentifizierung bleiben beim bestehenden Sites-Backend mit D1.
Web und iOS verwenden dieselbe Datenbank. Bei einem Domainwechsel müssen
Bestandsnutzer sich wegen der auf den Host beschränkten Cookies einmal anmelden.

## E-Mail

Beim Sites-Backend AUTH_PUBLIC_ORIGIN auf https://njora.de setzen. Sobald die
Absenderdomain bei Resend verifiziert ist, AUTH_EMAIL_FROM und den auf diesen
Absender begrenzten RESEND_API_KEY hinterlegen. Registrierung und Passwort-Reset
danach mit einem Testpostfach über die öffentliche Adresse prüfen. Die öffentliche
Registrierung erfordert den Mailnachweis auch bei ausgeschalteter Beta-Option.
AUTH_REQUIRE_EMAIL_VERIFICATION separat erst nach Prüfung der Altbestände
umstellen, da die Einstellung auch bestehende Sitzungen betrifft.

## Sicherung und Wiederherstellung

Der geschützte Backend-Export enthält Konten, Finanzpläne, Aktivitätsmetadaten und Passwort-Hashes. Format 2 enthält zusätzlich die Zuordnung der Abonnements. Nach einer Wiederherstellung melden sich die Nutzer neu an. Einmal-Links, Sitzungen und ChatGPT-Freigaben werden nicht wiederhergestellt.

### Verschlüsselten Export einrichten

Einen dauerhaften Backup-Host mit Node.js ab 22.13 bereitstellen. Ein vorhandenes, vom Produktivsystem getrenntes Sicherungsziel als Verzeichnis einbinden. Der Job benötigt Schreibzugriff und ein Dateisystem mit atomaren Hardlinks. Den öffentlichen RSA-Schlüssel des festgelegten Recovery-Empfängers im PEM-Format auf dem Host bereitstellen und dessen Fingerabdruck mit dem Empfänger abgleichen. Den privaten Schlüssel nur im getrennten Recovery-System aufbewahren.

Ein eigenes zufälliges Secret unter `NJORA_BACKUP_EXPORT_TOKEN` im produktiven Sites-Backend und als geschützte Umgebungsvariable beim Sicherungsjob hinterlegen. Ein Admin-Login wird nicht benötigt. Der Betreiber kann diesen Befehl in seinen vorhandenen serverseitigen Scheduler übernehmen:

    node scripts/njora-backup.mjs create /mnt/offsite/njora /etc/njora/recovery-public.pem

Der Befehl ruft ausschließlich den HTTPS-Export auf njora.de ab, prüft HTTP-Status und Exportformat und verschlüsselt den Inhalt im Arbeitsspeicher. Die Rheinland-Suite-Hülle verwendet RSA-OAEP-SHA256 und AES-256-GCM mit einem eigenen, authentifizierten Kontext für Njora. Ein vollständiges Archiv erscheint unter einem neuen Namen mit UTC-Zeitstempel und der Endung `.json.enc`. Die Datei erhält die Rechte 0600. Die Obergrenze beträgt 64 MiB pro unkomprimiertem Export. Ein Fehler liefert einen Exitcode ungleich null. Vorhandene Sicherungen bleiben erhalten.

Nach der Aktivierung den Erfolg des ersten Laufs am Ziel prüfen. Im Scheduler über fehlgeschlagene Läufe und ein überfälliges letztes Archiv benachrichtigen. Sicherungsintervall und Aufbewahrung legt der Betreiber fest.

### Wiederherstellen

In einem isolierten Recovery-System den passenden Stand des Repositorys einschließlich `drizzle/`, Node.js und Python 3 bereitstellen. Ein neues Ziel auf einem geschützten Datenträger wählen. Bei einem passwortgeschützten PEM-Schlüssel die Passphrase über `NJORA_RECOVERY_PASSPHRASE` als Secret bereitstellen.

    node scripts/njora-backup.mjs restore /mnt/offsite/njora/ARCHIV.json.enc /geschuetzt/recovery-private.pem /geschuetzt/probe.sqlite

Der Befehl prüft den Empfänger und die Authentizität des Archivs, übergibt den Klartext über eine Pipe an das Restore-Werkzeug und prüft die SQLite-Integrität und die Fremdschlüssel. Die neue SQLite-Datei enthält lesbare personenbezogene Daten und wird mit 0600 angelegt. Bei einem vorhandenen Ziel wird der Restore abgebrochen. Das ältere Werkzeug unterstützt weiterhin vorhandene JSON-Exporte der Formate 1 und 2:

    python3 scripts/restore-njora-backup.py /geschuetzt/altbestand.json /geschuetzt/probe.sqlite

Vor einem produktiven Datenbankwechsel die erwarteten Konten, Pläne und Abo-Zuordnungen im isolierten Ziel prüfen. Seit dem Sicherungsdatum gelöschte Konten dürfen nicht wieder aktiviert werden. Der lokale Ende-zu-Ende-Test arbeitet vollständig mit synthetischen Daten:

    node --test tests/backup-encryption.test.mjs tests/restore-backup.test.mjs

## iOS

Die SwiftUI-App (Bundle-ID `de.njora.finanzueberblick`) enthält ihre Oberfläche im App-Paket und verwendet die HTTPS-API auf njora.de. Die App und ihre WidgetKit-Erweiterung haben dieselbe Buildnummer.
Datenschutz: https://njora.de/datenschutz. Support: https://njora.de/support.
Vor der Einreichung auf einem echten Gerät Anmeldung, Datenexport, Erinnerung,
Netzausfall und Kontolöschung prüfen. Für die Apple-Prüfung ein eigenes Konto mit
erfundenen Daten verwenden. In den Review Notes den manuellen Budgetplaner sowie
die native Teilen-Funktion und die lokalen Check-in-Erinnerungen beschreiben.
