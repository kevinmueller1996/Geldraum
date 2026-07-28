# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Geldraum E-Mail-/Passwort-Login

Geldraum uses an app-owned D1 authentication layer instead of an external
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

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
