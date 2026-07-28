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

test("renders Geldraum locally without requiring authentication", async () => {
  await withPreview(async (response, baseUrl) => {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");

    const html = await response.text();
    assert.match(html, /<title>Geldraum – Heute klar\. Morgen frei\.<\/title>/i);
    assert.match(html, /Geldraum wird geladen/);
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

test("keeps finance plans and market quotes behind server-side identity", async () => {
  const [route, quoteRoute, searchRoute, page, layout, localHost, schema, hosting] = await Promise.all([
    readFile(new URL("../app/api/account/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/market/quotes/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/market/search/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/local-host.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.match(hosting, /"d1":\s*"DB"/);
  assert.match(schema, /financePlans/);
  assert.match(schema, /revision/);
  assert.match(route, /getChatGPTUser\(\)/);
  assert.match(route, /isLocalHostname\(hostname\)/);
  assert.match(route, /local: identity\.local/);
  assert.match(route, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(route, /WHERE user_id = \?/);
  assert.match(route, /body\.revision !== existing\.revision/);
  assert.match(route, /if \(!isSameOrigin\(request\)\)/);
  assert.doesNotMatch(route, /body\.(userId|email)/);
  assert.match(route, /validList\(value\.savings/);
  assert.match(quoteRoute, /getChatGPTUser\(\)/);
  assert.match(quoteRoute, /if \(!isSameOrigin\(request\)\)/);
  assert.match(quoteRoute, /query2\.finance\.yahoo\.com/);
  assert.match(quoteRoute, /priceEur: quote\.price \* exchangeRate/);
  assert.match(quoteRoute, /body\.symbols\.length > 20/);
  assert.match(searchRoute, /getChatGPTUser\(\)/);
  assert.match(searchRoute, /finance\/autocomplete/);
  assert.match(searchRoute, /region", "DE"/);
  assert.match(searchRoute, /\["S", "E", "M"\]/);
  assert.match(searchRoute, /function instrumentKey/);
  assert.match(searchRoute, /const grouped = new Map/);
  assert.match(searchRoute, /sourcePriority - b\.sourcePriority/);
  assert.match(localHost, /normalized === "localhost"/);
  assert.match(localHost, /normalized\.endsWith\("\.localhost"\)/);
  assert.match(localHost, /normalized === "127\.0\.0\.1"/);
  assert.match(localHost, /normalized === "\[::1\]"/);
  assert.doesNotMatch(localHost, /192\.168|10\.0\./);
  assert.match(page, /isLocalHostname\(window\.location\.hostname\)/);
  assert.match(page, /Keine Anmeldung erforderlich/);
  assert.match(page, /Als App auf dem iPhone/);
  assert.match(page, /!cloudUser\?\.local && <a href="\/signout-with-chatgpt/);
  assert.match(layout, /viewportFit: "cover"/);
  assert.match(layout, /appleWebApp: \{ capable: true/);
  assert.match(layout, /PwaRegistration/);
  assert.match(page, /Diese lokalen Daten gehören mir|Gehört dieser Finanzplan dir/);
  assert.match(page, /Depot & Ersparnisse/);
  assert.match(page, /Wertpapierkurse aktualisieren/);
  assert.match(page, /aria-autocomplete="list"/);
  assert.match(page, /Handelsplatz wird automatisch gewählt/);
  assert.doesNotMatch(page, /localStorage\.setItem/);
  assert.match(page, /Account und Finanzdaten löschen/);
});
