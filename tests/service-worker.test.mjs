import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://njora.example";

function serviceWorker(fetch, cache) {
  const handlers = {};
  vm.runInNewContext(source, {
    self: { location: { origin }, addEventListener: (type, handler) => { handlers[type] = handler; } },
    caches: {open: async () => cache, match: key => cache.match(key)}, fetch, URL,
  });
  return async (path, mode = "cors") => {
    const background = [];
    let response;
    handlers.fetch({
      request: {url: origin + path, method: "GET", mode},
      respondWith(task) { response = task; },
      waitUntil(task) { background.push(task); },
    });
    const result = await response;
    await Promise.all(background);
    return result;
  };
}

test("a full offline cache cannot replace a successful page or asset with an offline response", async () => {
  const worker = serviceWorker(async () => new Response("network", {headers: {"Content-Type":"text/html"}}), {
    match: async () => undefined, put: async () => { throw new Error("Quota exceeded"); },
  });
  assert.equal(await (await worker("/", "navigate")).text(), "network");
  assert.equal(await (await worker("/_next/static/test.js")).text(), "network");
});

test("only navigation falls back to cached HTML; route data and account requests stay out of Cache Storage", async () => {
  const worker = serviceWorker(async () => { throw new Error("Offline"); }, {
    match: async key => new Response(key === "/" ? "shell" : "offline"),
  });
  assert.equal(await (await worker("/", "navigate")).text(), "shell");
  assert.equal(await (await worker("/support", "navigate")).text(), "offline");
  for (const path of ["/", "/?_rsc=abc", "/api/account"]) assert.equal(await worker(path), undefined);
});
