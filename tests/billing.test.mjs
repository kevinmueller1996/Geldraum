import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Exercise the worker's actual checkout code, replacing only its platform bindings and provider transport.
const source = (await readFile(new URL("../app/billing/subscription.ts", import.meta.url), "utf8"))
  .replace('import { env } from "cloudflare:workers";', "const env = globalThis.njoraBillingTestEnv;");
globalThis.njoraBillingTestEnv = { NJORA_STRIPE_PRICE:"price_njora", NJORA_STRIPE_SECRET:"test" };
const compiled = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
const api = await import("data:text/javascript;base64,"+Buffer.from(compiled.outputText).toString("base64"));
const row = {user_id:"test",account_token:"test-token",stripe_customer:"cus_test",apple_original:null,apple_environment:null};
function provider(t, {history=[], amount=99, open=false}={}) {
  let params;
  t.mock.method(globalThis,"fetch",async (url, options) => {
    assert.equal(options.redirect, "manual");
    const path = new URL(url).pathname;
    let response;
    if (path.endsWith("/prices/price_njora")) response = {active:true,currency:"eur",unit_amount:amount,recurring:{interval:"month",interval_count:1},tax_behavior:"inclusive"};
    else if (path.endsWith("/subscriptions")) response = {data:history.map(status=>({status,items:{data:[{price:{id:"price_njora"}}]}}))};
    else if (path.endsWith("/checkout/sessions") && options.method === "GET") response = {data:open ? [{id:"cs_test",status:"open",url:"https://checkout.stripe.com/open"}] : []};
    else if (path.endsWith("/checkout/sessions") && options.method === "POST") {
      params = options.body; response={url:"https://checkout.stripe.com/new"};
    } else throw Error("Unexpected provider call");
    return Response.json(response);
  });
  return () => params;
}
test("web trial requires payment details and runs for exactly 30 days",async t=>{
  const fields=provider(t); await api.checkout(row,"test@example.org");
  assert.equal(fields().get("subscription_data[trial_period_days]"),"30");
  assert.equal(fields().get("payment_method_collection"),"always");
  assert.equal(fields().get("line_items[0][price]"),"price_njora");
});
test("returning subscribers do not receive a second trial",async t=>{
  const fields=provider(t,{history:["canceled"]}); await api.checkout(row,"test@example.org");
  assert.equal(fields().has("subscription_data[trial_period_days]"),false);
});
test("a trial already grants access and precludes another checkout",async t=>{
  provider(t,{history:["trialing"]}); assert.equal((await api.membership(row)).active,true);
  await assert.rejects(api.checkout(row,"test@example.org"),/bereits/);
});
test("unexpected price blocks checkout",async t=>{
  provider(t,{amount:199}); await assert.rejects(api.checkout(row,"test@example.org"),/Monatspreis/);
});
test("retry resumes existing checkout",async t=>{
  const fields=provider(t,{open:true}); assert.equal(await api.checkout(row,"test@example.org"),"https://checkout.stripe.com/open"); assert.equal(fields(),undefined);
});
test("production rejects a sandbox purchase outside the review account",async()=>{
  await assert.rejects(api.confirmApple(row,"12345","Sandbox"),/Kaufumgebung/);
});

test("Apple verification uses Worker-compatible redirects and rejects a redirect", async t => {
  const env = globalThis.njoraBillingTestEnv;
  const keys = await crypto.subtle.generateKey({name:"ECDSA", namedCurve:"P-256"}, true, ["sign", "verify"]);
  const keyBytes = await crypto.subtle.exportKey("pkcs8", keys.privateKey);
  Object.assign(env, {
    NJORA_APPLE_ISSUER: "test-issuer", NJORA_APPLE_KEY_ID: "test-key",
    NJORA_APPLE_PRIVATE_KEY: Buffer.from(keyBytes).toString("base64"),
    NJORA_APPLE_SANDBOX_REVIEW_USER_ID: row.user_id
  });
  t.after(() => {
    for (const key of Object.keys(env).filter(key => key.startsWith("NJORA_APPLE_"))) delete env[key];
  });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(new URL(url).hostname, "api.storekit-sandbox.apple.com");
    assert.equal(options.redirect, "manual");
    return new Response(null, {status:302, headers:{Location:"https://example.invalid/"}});
  });
  await assert.rejects(api.confirmApple(row, "12345", "Sandbox"), /Apple konnte den Kauf nicht bestätigen/);
  assert.equal(calls, 1);
});
