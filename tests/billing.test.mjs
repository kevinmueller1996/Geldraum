import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Exercise the worker's actual checkout code, replacing only its platform bindings and provider transport.
const source = (await readFile(new URL("../app/billing/subscription.ts", import.meta.url), "utf8"))
  .replace('import { env } from "cloudflare:workers";', "const env = globalThis.njoraBillingTestEnv;");
globalThis.njoraBillingTestEnv = { NJORA_STRIPE_PRICE:"price_njora", NJORA_STRIPE_BUSINESS_PRICE:"price_business", NJORA_STRIPE_SECRET:"test" };
const compiled = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
const api = await import("data:text/javascript;base64,"+Buffer.from(compiled.outputText).toString("base64"));
const row = {user_id:"test",account_token:"test-token",stripe_customer:"cus_test",apple_original:null,apple_environment:null};
function provider(t, {history=[], amount=99, open=false, price="price_njora"}={}) {
  let params;
  t.mock.method(globalThis,"fetch",async (url, options) => {
    assert.equal(options.redirect, "manual");
    const path = new URL(url).pathname;
    let response;
    if (path.endsWith("/prices/"+price)) response = {active:true,currency:"eur",unit_amount:amount,recurring:{interval:"month",interval_count:1},tax_behavior:"inclusive"};
    else if (path.endsWith("/subscriptions")) response = {data:history.map(status=>({status,items:{data:[{price:{id:price}}]}}))};
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
test("business checkout charges 999 cents and returns to the company workspace",async t=>{
  const fields = provider(t,{amount:999,price:"price_business"});
  await api.checkout({...row,workspace:"business"},"test@example.org");
  assert.equal(fields().get("line_items[0][price]"),"price_business");
  assert.equal(new URL(fields().get("success_url")).searchParams.get("bereich"),"business");
});
test("personal subscriptions only unlock the personal workspace",async t=>{
  provider(t,{history:["active"]});
  assert.equal((await api.membership(row)).active,true);
  assert.equal((await api.membership({...row,workspace:"business"})).active,false);
});
test("business subscriptions only unlock the business workspace",async t=>{
  provider(t,{history:["trialing"],price:"price_business"});
  assert.equal((await api.membership(row)).active,false);
  assert.equal((await api.membership({...row,workspace:"business"})).active,true);
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

test("before launch only the authenticated Apple sandbox account enters billing", t => {
  const env = globalThis.njoraBillingTestEnv;
  assert.equal(api.billingEnabled(), false);
  assert.equal(api.billingEnabled(""), false);
  t.after(() => { delete env.NJORA_APPLE_SANDBOX_REVIEW_USER_ID; delete env.NJORA_BILLING_ENABLED; });
  env.NJORA_APPLE_SANDBOX_REVIEW_USER_ID = "review-user";
  assert.equal(api.billingEnabled("review-user"), true);
  assert.equal(api.billingEnabled("existing-user"), false);
  assert.equal(api.billingEnabled(), false);
  env.NJORA_BILLING_ENABLED = "true";
  assert.equal(api.billingEnabled("existing-user"), true);
  assert.equal(api.billingEnabled(), true);
});

test("Apple review purchase, restore and provider failures", async t => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const review = { ...row, stripe_customer: null };
  const original = "1000001";
  const bundle = "de.njora.finanzueberblick";
  const writes = [];
  let currentAccount = true;
  const env = globalThis.njoraBillingTestEnv;
  const bindings = {
    NJORA_APPLE_SANDBOX_REVIEW_USER_ID: review.user_id,
    NJORA_APPLE_ISSUER: "test-issuer",
    NJORA_APPLE_KEY_ID: "test-key",
    NJORA_APPLE_PRIVATE_KEY: privateKey.export({type: "pkcs8", format: "pem"}),
    DB: { prepare: () => ({ bind: (...args) => ({ run: async () => { if (currentAccount) writes.push(args); return {meta:{changes:currentAccount ? 1 : 0}}; } }) }) }
  };
  Object.assign(env, bindings);
  t.after(() => { for (const key of Object.keys(bindings)) delete env[key]; });

  let appleHTTP = 200;
  let status = 1;
  const transaction = {
    originalTransactionId: original, environment: "Sandbox", bundleId: bundle,
    productId: api.appleProduct, appAccountToken: review.account_token
  };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (new URL(url).hostname === "api.stripe.com") return new Response(null, {status:503});
    assert.equal(url, "https://api.storekit-sandbox.apple.com/inApps/v1/subscriptions/" + original);
    assert.equal(options.redirect, "manual");
    const auth = new Headers(options.headers).get("authorization");
    assert.ok(auth.startsWith("Bearer "));
    const [header, claims, signature] = auth.slice(7).split(".");
    const decode = part => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    assert.deepEqual(decode(header), {alg: "ES256", kid: "test-key", typ: "JWT"});
    const { iss, aud, bid, iat, exp } = decode(claims);
    assert.equal(iss, "test-issuer");
    assert.equal(aud, "appstoreconnect-v1");
    assert.equal(bid, bundle);
    assert.equal(exp - iat, 300);
    assert.ok(verify("sha256", Buffer.from(header + "." + claims),
      {key: publicKey, dsaEncoding: "ieee-p1363"}, Buffer.from(signature, "base64url")));
    if (appleHTTP !== 200) return new Response(null, {status: appleHTTP});
    const payload = Buffer.from(JSON.stringify(transaction)).toString("base64url");
    return Response.json({ bundleId: bundle, environment: "Sandbox",
      data: [{ lastTransactions: [{ status, signedTransactionInfo: "fixture." + payload + ".fixture" }] }] });
  });

  const confirm = () => api.confirmApple(review, original, "Sandbox");
  await t.test("purchase and restore link the same original transaction", async () => {
    assert.deepEqual(await confirm(), {active: true});
    assert.deepEqual(await confirm(), {active: true});
    const expectedLink = [original, "Sandbox", review.user_id, review.account_token];
    assert.deepEqual(writes, [expectedLink, expectedLink]);
    const linked = { ...review, apple_original: original, apple_environment: "Sandbox" };
    assert.equal((await api.membership(linked)).provider, "apple");
  });
  await t.test("an Apple purchase only unlocks the matching workspace", async () => {
    const company = {...review,workspace:"business"};
    await assert.rejects(api.confirmApple(company,original,"Sandbox"), /gehört nicht/);
    transaction.productId = "de.njora.finanzueberblick.business.monthly";
    assert.deepEqual(await api.confirmApple(company,original,"Sandbox"),{active:true});
    await assert.rejects(confirm(), /gehört nicht/);
    transaction.productId = api.appleProduct;
  });
  await t.test("a late purchase response cannot reattach to a recreated account", async () => {
    currentAccount = false;
    await assert.rejects(confirm(), /inzwischen geändert/);
    currentAccount = true;
  });
  await t.test("an Apple subscriber retains access during a Stripe outage", async () => {
    const linked = { ...review, stripe_customer:"old-customer", apple_original:original, apple_environment:"Sandbox" };
    assert.equal((await api.membership(linked)).provider,"apple");
    status = 2;
    await assert.rejects(api.membership(linked));
    status = 1;
  });
  await t.test("expired, revoked and mismatched purchases cannot grant access", async () => {
    const before = writes.length;
    status = 2;
    assert.deepEqual(await confirm(), {active: false});
    status = 1;
    transaction.revocationDate = Date.now();
    assert.deepEqual(await confirm(), {active: false});
    delete transaction.revocationDate;
    transaction.appAccountToken = "other-test-account";
    await assert.rejects(confirm(), /gehört nicht zu diesem Njora-Konto/);
    transaction.appAccountToken = review.account_token;
    assert.equal(writes.length, before);
  });
  await t.test("an Apple authorization failure cannot grant access", async () => {
    const before = writes.length;
    appleHTTP = 401;
    await assert.rejects(confirm(), /Apple konnte den Kauf nicht bestätigen/);
    assert.equal(writes.length, before);
  });
});
