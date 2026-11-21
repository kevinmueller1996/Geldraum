import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

test("Njora forms keep the same-origin referrer policy through the web proxy", async t => {
  const bundle = await build({
    stdin: { contents: 'export { page } from "./app/chatgpt/pages"; export { proxyPlugin } from "./app/chatgpt/proxy";', resolveDir: process.cwd() },
    write: false, bundle: true, format: "esm", platform: "node", alias: { "server-only": "next/dist/compiled/server-only/empty" },
  });
  const { page, proxyPlugin } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].contents).toString("base64"));
  const request = new Request("https://njora.de/api/chatgpt/authorize");
  const form = page("Freigabe", "<form></form>");
  assert.equal(form.headers.get("referrer-policy"), "same-origin");
  const upstream = t.mock.method(globalThis, "fetch", async () => form);
  const proxied = await proxyPlugin(request, "authorize");
  assert.equal(proxied.headers.get("referrer-policy"), "same-origin");
  upstream.mock.mockImplementation(async () => Response.redirect("https://chatgpt.com/connector_platform_oauth_redirect", 303));
  const redirect = await proxyPlugin(request, "authorize");
  assert.equal(redirect.headers.get("referrer-policy"), "no-referrer");
});
