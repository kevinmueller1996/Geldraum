import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function withPreview(callback) {
  const port = 43_000 + (process.pid % 1_000);
  const preview = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  preview.stdout.on("data", (chunk) => { output += chunk; });
  preview.stderr.on("data", (chunk) => { output += chunk; });

  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://localhost:${port}/`, {
          headers: { accept: "text/html" },
        });
        if (response.ok) return await callback(response, `http://localhost:${port}`);
      } catch {
        // The preview process is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`Preview did not start in time.\n${output}`);
  } finally {
    preview.kill("SIGTERM");
  }
}

test("renders Njora locally without requiring authentication", async () => {
  await withPreview(async (response, baseUrl) => {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");

    const html = await response.text();
    assert.match(html, /<title>Njora – Verstehe, was war\. Gestalte, was kommt\.<\/title>/i);
    assert.match(html, /Njora wird geladen/);
    assert.match(html, /favicon\.png/);
    assert.match(html, /manifest\.webmanifest/);
    assert.match(html, /apple-touch-icon\.png/);
    assert.match(html, /og\.png/);
    assert.doesNotMatch(html, /codex-preview|Klarbudget|Your site is taking shape/i);

    const accountResponse = await fetch(`${baseUrl}/api/account`, { headers: { accept: "application/json" } });
    assert.equal(accountResponse.status, 200);
    const account = await accountResponse.json();
    assert.equal(account.authenticated, true);
    assert.equal(account.user.local, true);

    const loginResponse = await fetch(`${baseUrl}/login`, { headers: { accept: "text/html" } });
    assert.equal(loginResponse.status, 200);
    const loginHtml = await loginResponse.text();
    assert.match(loginHtml, /E-Mail-Adresse/);
    assert.match(loginHtml, /Konto erstellen/);
    assert.doesNotMatch(loginHtml, /Sign in with ChatGPT|signin-with-chatgpt/i);

    const email = `auth-${process.pid}-${Date.now()}@example.invalid`;
    const password = "Test-Passwort-2026!";
    const authHeaders = { "Content-Type": "application/json", Origin: baseUrl };
    const registration = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ email, password }),
    });
    assert.equal(registration.status, 201);
    const registrationCookie = registration.headers.get("set-cookie") ?? "";
    assert.match(registrationCookie, /geldraum_session=/);
    assert.match(registrationCookie, /HttpOnly/i);
    assert.match(registrationCookie, /SameSite=Lax/i);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Origin: baseUrl, Cookie: registrationCookie.split(";", 1)[0] },
    });
    assert.equal(logout.status, 200);

    const invalidLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ email, password: "Falsches-Passwort!" }),
    });
    assert.equal(invalidLogin.status, 401);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ email, password }),
    });
    assert.equal(login.status, 200);
    const loginCookie = login.headers.get("set-cookie") ?? "";
    assert.match(loginCookie, /geldraum_session=/);

    const deletion = await fetch(`${baseUrl}/api/account`, {
      method: "DELETE",
      headers: { Origin: baseUrl, Cookie: loginCookie.split(";", 1)[0] },
    });
    assert.equal(deletion.status, 200);

    const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
    assert.equal(manifestResponse.status, 200);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.orientation, "portrait-primary");

    const workerResponse = await fetch(`${baseUrl}/sw.js`);
    assert.equal(workerResponse.status, 200);
    const worker = await workerResponse.text();
    assert.doesNotMatch(worker, /caches\.open|addEventListener\("fetch"/);
  });
});

test("keeps finance plans and market quotes behind password sessions", async () => {
  const [route, adminRoute, adminAuthRoute, quoteRoute, searchRoute, passwordAuth, loginRoute, registerRoute, logoutRoute, loginPage, page, layout, localHost, schema, viteConfig] = await Promise.all([
    readFile(new URL("../app/api/account/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/testers/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/auth/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/market/quotes/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/market/search/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/password-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/register/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/logout/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/local-host.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  ]);

  assert.match(viteConfig, /readFileSync/);
  assert.match(viteConfig, /return \{ d1: "DB", r2: null \}/);
  assert.match(schema, /financePlans/);
  assert.match(schema, /revision/);
  assert.match(schema, /authCredentials/);
  assert.match(schema, /authSessions/);
  assert.match(schema, /authAttempts/);
  assert.match(route, /getSessionIdentity\(request\)/);
  assert.match(route, /isLocalHostname\(hostname\)/);
  assert.match(route, /local: identity\.local/);
  assert.match(route, /identity\.emailMask/);
  assert.match(route, /user_activity/);
  assert.match(route, /WHERE user_id = \?/);
  assert.match(route, /body\.revision !== existing\.revision/);
  assert.match(route, /if \(!isSameOrigin\(request\)\)/);
  assert.doesNotMatch(route, /body\.(userId|email)/);
  assert.match(route, /validList\(value\.savings/);
  assert.match(quoteRoute, /isRequestAuthenticated\(request\)/);
  assert.match(quoteRoute, /if \(!isSameOrigin\(request\)\)/);
  assert.match(quoteRoute, /query2\.finance\.yahoo\.com/);
  assert.match(quoteRoute, /priceEur: quote\.price \* exchangeRate/);
  assert.match(quoteRoute, /body\.symbols\.length > 20/);
  assert.match(searchRoute, /isRequestAuthenticated\(request\)/);
  assert.match(searchRoute, /finance\/autocomplete/);
  assert.match(searchRoute, /region", "DE"/);
  assert.match(searchRoute, /\["S", "E", "M"\]/);
  assert.match(searchRoute, /function instrumentKey/);
  assert.match(searchRoute, /const grouped = new Map/);
  assert.match(searchRoute, /sourcePriority - b\.sourcePriority/);
  assert.match(adminRoute, /GELDRAUM_ADMIN_TOKEN/);
  assert.match(adminRoute, /validToken\(provided, expected\)/);
  assert.match(adminRoute, /testerCode: `T-\$\{row\.user_id\.slice\(0, 10\)/);
  assert.doesNotMatch(adminRoute, /plan_json|display_name/);
  assert.match(adminAuthRoute, /GELDRAUM_ADMIN_USER_ID/);
  assert.match(adminAuthRoute, /verifyPasswordAccount/);
  assert.match(adminAuthRoute, /equalSecret\(result\.id, expectedUserId\)/);
  assert.match(passwordAuth, /bcryptHash/);
  assert.match(passwordAuth, /PASSWORD_COST = 11/);
  assert.match(passwordAuth, /PASSWORD_SCHEME = "bcrypt"/);
  assert.match(passwordAuth, /httpOnly: true/);
  assert.match(passwordAuth, /sameSite: "lax"/);
  assert.match(passwordAuth, /LOGIN_MAX_FAILURES = 5/);
  assert.match(passwordAuth, /auth_sessions/);
  assert.match(passwordAuth, /bcryptCompare/);
  assert.doesNotMatch(passwordAuth, /oai-authenticated-user|ChatGPT/);
  assert.match(loginRoute, /loginPasswordAccount/);
  assert.match(registerRoute, /registerPasswordAccount/);
  assert.match(logoutRoute, /destroySession/);
  assert.match(loginPage, /autocomplete="current-password"|current-password/);
  assert.match(loginPage, /Mindestens 10 Zeichen/);
  assert.match(localHost, /normalized === "localhost"/);
  assert.match(localHost, /normalized\.endsWith\("\.localhost"\)/);
  assert.match(localHost, /normalized === "127\.0\.0\.1"/);
  assert.match(localHost, /normalized === "\[::1\]"/);
  assert.doesNotMatch(localHost, /192\.168|10\.0\./);
  assert.match(page, /isLocalHostname\(window\.location\.hostname\)/);
  assert.match(page, /Keine Anmeldung erforderlich/);
  assert.match(page, /Als App auf dem iPhone/);
  assert.match(page, /fetch\("\/api\/auth\/logout"/);
  assert.match(page, /href="\/login"/);
  assert.match(layout, /viewportFit: "cover"/);
  assert.match(layout, /appleWebApp: \{ capable: true/);
  assert.match(layout, /PwaRegistration/);
  assert.match(page, /Diese lokalen Daten gehören mir|Gehört dieser Finanzplan dir/);
  assert.match(page, /Kurzer Fragebogen · etwa 3 Minuten/);
  assert.match(page, /Schritt \{onboardingStep \+ 1\} von/);
  assert.match(page, /Pflicht/);
  assert.match(page, /Optional/);
  assert.match(page, /Njora starten/);
  assert.match(page, /function onboardingIssue/);
  assert.match(page, /Depot & Ersparnisse/);
  assert.match(page, /Wertpapierkurse aktualisieren/);
  assert.match(page, /aria-autocomplete="list"/);
  assert.match(page, /Handelsplatz wird automatisch gewählt/);
  assert.doesNotMatch(page, /localStorage\.setItem/);
  assert.match(page, /Account und Finanzdaten löschen/);
  assert.doesNotMatch(page + loginPage + route + quoteRoute + searchRoute, /signin-with-chatgpt|signout-with-chatgpt|getChatGPTUser/);
});

test("provides a native Next.js build and server-only D1 adapter for Vercel", async () => {
  const [packageJson, vercelConfig, nextConfig, adapter, declarations, readme] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/vercel/cloudflare-workers.ts", import.meta.url), "utf8"),
    readFile(new URL("../cloudflare-workers.d.ts", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson, /"build:vercel":\s*"VERCEL=1 next build"/);
  assert.match(vercelConfig, /"framework":\s*"nextjs"/);
  assert.match(vercelConfig, /"buildCommand":\s*"npm run build:vercel"/);
  assert.match(nextConfig, /"cloudflare:workers":\s*"\.\/app\/vercel\/cloudflare-workers\.ts"/);
  assert.match(adapter, /import "server-only"/);
  assert.match(adapter, /api\.cloudflare\.com\/client\/v4\/accounts/);
  assert.match(adapter, /CLOUDFLARE_D1_API_TOKEN/);
  assert.match(adapter, /cache: "no-store"/);
  assert.doesNotMatch(adapter, /Bearer\s+[A-Za-z0-9_-]{20,}/);
  assert.match(declarations, /declare module "cloudflare:workers"/);
  assert.match(readme, /Deployment auf Vercel/);
  assert.match(readme, /D1 Read und D1 Write/);
});
