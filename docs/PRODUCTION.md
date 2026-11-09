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

Der geschützte Backend-Export /api/admin/backup enthält Konten, Finanzpläne,
Aktivitätsmetadaten und Passwort-Hashes. Bestehende Sitzungen, Anmeldeversuche
und Einmal-Links sind ausgeschlossen. Sicherung nur verschlüsselt und getrennt
vom Produktivsystem aufbewahren. Den Export nie in Git ablegen.

Wiederherstellung mit einem Export in einem isolierten Verzeichnis prüfen:

    python3 scripts/restore-njora-backup.py /sicherer/pfad/njora-backup.json /sicherer/pfad/njora-restore.sqlite

Das Werkzeug erstellt ausschließlich eine neue lokale Datei. Es überschreibt
keine vorhandene Datenbank. Für einen produktiven Restore zunächst ein isoliertes
Ziel aufbauen, Konten und Pläne prüfen und den Datenbankwechsel separat planen.
Gelöschte Konten dürfen bei einer Wiederherstellung nicht unbemerkt reaktiviert werden.

## iOS

Bundle-ID de.njora.finanzueberblick, Build 2. Der Release-Build lädt https://njora.de.
Datenschutz: https://njora.de/datenschutz. Support: https://njora.de/support.
Vor der Einreichung auf einem echten Gerät Anmeldung, Datenexport, Erinnerung,
Netzausfall und Kontolöschung prüfen. Für die Apple-Prüfung ein eigenes Konto mit
erfundenen Daten verwenden. In den Review Notes den manuellen Budgetplaner sowie
die native Teilen-Funktion und die lokalen Check-in-Erinnerungen beschreiben.
