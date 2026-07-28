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
- `.openai/hosting.example.json` ist die neutrale lokale Vorlage.

## Njora E-Mail-/Passwort-Login

Njora uses an app-owned D1 authentication layer instead of an external
identity provider:

- normalized email addresses are represented by a SHA-256 user id and are not
  stored in plaintext;
- passwords are stored as salted bcrypt hashes with work factor 11;
- sessions use random tokens while only their hashes are persisted;
- the browser receives an HttpOnly, SameSite cookie;
- repeated failed login attempts are temporarily locked;
- deleting an account also removes credentials, sessions, activity metadata,
  and the finance plan.

Existing plans remain attached when a previous tester registers with the same
email address, because the deterministic user id is unchanged.

## Deployment auf Vercel

Vercel verwendet über `vercel.json` den nativen Next.js-Build und erzeugt die
erwartete `.next`-Ausgabe. Die API-Routen greifen serverseitig über die
Cloudflare D1 Query API auf dieselbe Datenbank wie die Cloudflare-Version zu.

Folgende Environment Variables müssen im Vercel-Projekt für Production,
Preview und Development hinterlegt werden:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `CLOUDFLARE_D1_API_TOKEN` mit D1 Read und D1 Write
- `GELDRAUM_ADMIN_TOKEN` und `GELDRAUM_ADMIN_USER_ID`, falls die Admin-App
  weiterhin auf diese Instanz zugreifen soll

Die Werte gehören ausschließlich in die Vercel-Projekteinstellungen und
dürfen nicht in GitHub committed werden.

## Befehle

- `npm run dev`: lokale Entwicklung starten
- `npm run build`: Produktions-Build prüfen
- `npm test`: Build und Integrationsprüfungen ausführen
- `npm run db:generate`: Migrationen nach Schemaänderungen erzeugen

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
