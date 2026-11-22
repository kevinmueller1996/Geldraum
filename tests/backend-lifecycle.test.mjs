import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { build } from "esbuild";
import { NextRequest, NextResponse } from "next/server.js";
import { backupPlan } from "../app/plan-validation.ts";
import { formBodyLimit, readBodyBytes, readFormObject } from "../app/request-body.ts";

function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  const prepare = (statement, args = []) => {
    const query = sql.prepare(statement);
    return {
      bind: (...params) => prepare(statement, params),
      first: () => query.get(...args) ?? null,
      run: () => query.columns().length ? {results:query.all(...args),meta:{changes:0}} : {results:[],meta: { changes: Number(query.run(...args).changes) }},
      all: () => ({results: query.all(...args)})
    };
  };
  return {
    sql, prepare,
    batch(statements) {
      sql.exec("BEGIN");
      try {
        const result = statements.map(statement => statement.run());
        sql.exec("COMMIT");
        return result;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    }
  };
}

async function backend(env) {
  const output = await build({
    stdin: { contents: `
      export * as billing from "./app/billing/subscription";
      export * as backup from "./app/api/admin/backup/route";
      export * as account from "./app/api/account/route";
      export * as register from "./app/api/auth/register/route";
      export * as verify from "./app/api/auth/verify-email/route";
      export * as auth from "./app/password-auth";
      export * as admin from "./app/admin/admin-auth";
      export * as oauth from "./app/chatgpt/oauth";
      export * as changes from "./app/chatgpt/changes";
      export * as storage from "./app/chatgpt/storage";
      export * as config from "./app/chatgpt/config";
      export * as resetRoute from "./app/api/auth/reset-password/route";
      export * as forgotRoute from "./app/api/auth/forgot-password/route";
      export * as proxy from "./app/vercel/proxy-api";
      `, resolveDir: new URL("..", import.meta.url).pathname },
    bundle: true, packages: "external", platform: "node", format: "cjs", write: false
  });
  const require = createRequire(import.meta.url);
  const mod = {exports:{}};
  const fixtureRequire = name => {
    if (name === "cloudflare:workers") return {env};
    if (name === "server-only") return {};
    if (name === "next/headers") return { headers: () => env.currentHeaders };
    return require(name);
  };
  new Function("module", "exports", "require", output.outputFiles[0].text)(mod, mod.exports, fixtureRequire);
  return mod.exports;
}

const origin = "https://njora.de";
function request(url, method = "GET", data, cookie = "") {
  const headers = { origin, host: "njora.de", cookie };
  if (data) headers["content-type"] = "application/json";
  return new NextRequest(origin + url, {method, headers, body: data && JSON.stringify(data)});
}

const example = {name:"Plan", incomes:[], expenses:[], annualCosts:[], goals:[], accounts:[], savings:[], commitments:[], snapshots:[]};

test("legacy categories and optional dates must be compatible with all clients", () => {
  const cost = {id:"cost", name:"Beitrag", amount:120, month:3};
  assert.ok(backupPlan({...example, annualCosts:[cost]}));
  assert.equal(backupPlan({...example, annualCosts:[{...cost, category:42}]}), null);
  assert.equal(backupPlan({...example, annualCosts:[{...cost, bookingDay:36}]}), null);
  const goal = {id:"goal", name:"Urlaub", target:1000, saved:250};
  for (const targetDate of [undefined, "", "2028-02-29"]) assert.ok(backupPlan({...example, goals:[{...goal,targetDate}]}));
  assert.equal(backupPlan({...example, goals:[{...goal,targetDate:"2027-02-29"}]}),null);
  assert.equal(backupPlan({...example, snapshots:[{id:"s",date:"2026-11-31",balances:{},note:""}]}),null);
});

test("bounded request reads handle missing Content-Length and preserve exact UTF-8 bytes", async () => {
  const sample = "ö".repeat(45);
  const bytes = new TextEncoder().encode(sample);
  const post = () => new Request(origin, {method:"POST", body:new Blob([bytes])});
  assert.deepEqual(await readBodyBytes(post(),bytes.length),bytes);
  await assert.rejects(readBodyBytes(post(),bytes.length - 1),RangeError);
  const form = data => new Request(origin, {method:"POST", body:JSON.stringify(data)});
  assert.deepEqual(await readFormObject(form({name:"Müller"})), {name:"Müller"});
  assert.equal(await readFormObject(form(["unexpected"])), null);
  assert.equal(await readFormObject(form({value:"a".repeat(formBodyLimit)})), null);
});

test("verification, recovery, plan revisions and dependent records across one account lifetime", async t => {
  const db = database();
  t.after(() => db.sql.close());
  const env = { DB: db, AUTH_REQUIRE_EMAIL_VERIFICATION:"1", GELDRAUM_ADMIN_SESSION_TOKEN:"fixture-operator-secret" };
  const {auth,account,admin,billing,config,changes,storage,forgotRoute,resetRoute} = await backend(env);
  const email = "test-user@example.invalid";
  const password = "fixture first password", nextPassword = "fixture second password";
  const pending = await auth.registerPasswordAccount(email, undefined, true);
  assert.equal(pending.verificationRequired,true);
  const verified = await auth.confirmEmailVerification(pending.verificationToken,password);
  assert.ok(verified.token);
  assert.equal(await auth.confirmEmailVerification(pending.verificationToken,password),null);
  const login = await auth.loginPasswordAccount(email,password);
  env.GELDRAUM_ADMIN_USER_ID = login.id;
  const cookie = "__Host-njora_session=" + login.token;
  const originalProfile = await (await account.GET(request("/api/account","GET",null,cookie))).json();
  assert.ok(Number.isFinite(Date.parse(originalProfile.user.accountCreatedAt)));
  const put = (revision,name,c = cookie) => account.PUT(request("/api/account","PUT",{revision,plan:{...example,name}},c));
  assert.equal((await put(7,"outdated")).status,409);
  assert.equal((await put(null,"initial")).status,200);
  assert.equal((await put(1,"edited")).status,200);
  assert.equal((await put(1,"stale")).status,409);

  const businessPath = "/api/account/business";
  const getBusiness = c => account.GET(request(businessPath,"GET",null,c));
  const putBusiness = (revision,name) => account.PUT(request(businessPath,"PUT",{revision,plan:{...example,name}},cookie));
  assert.equal((await getBusiness(null)).status,401);
  const fresh = await (await getBusiness(cookie)).json();
  assert.equal(fresh.workspace,"business");
  assert.equal(fresh.plan,null);
  assert.equal((await putBusiness(null,"Unternehmen")).status,200);
  assert.equal((await putBusiness(null,"Duplikat")).status,409);
  assert.equal((await putBusiness(1,"Firmenplan")).status,200);
  assert.equal((await putBusiness(1,"Veraltete Firmenrevision")).status,409);
  assert.equal((await (await getBusiness(cookie)).json()).plan.name,"Firmenplan");
  assert.equal((await (await account.GET(request("/api/account","GET",null,cookie))).json()).plan.name,"edited");

  await storage.ensureTables();
  const token = config.randomToken();
  const now = Date.now(), version = db.sql.prepare("SELECT updated_at FROM auth_credentials").get().updated_at;
  db.sql.prepare("INSERT INTO njora_plugin_grants(id,user_id,scope,access_hash,access_until,expires,credential_version) VALUES(?,?,?,?,?,?,?)")
    .run("grant",login.id,"njora:read njora:write",await config.hash(token),now+600000,now+600000,version);
  const toolRequest = new Request(origin,{headers:{authorization:"Bearer "+token}});
  const grant = await changes.grantFor(toolRequest);
  assert.ok(grant);
  await changes.propose(grant,[{type:"invoice",name:"Rechnung",amount:25,dueDate:"2027-05-10"}]);
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM njora_plugin_proposals").get().n,1);

  const credential = await auth.verifyPasswordAccount(email,password);
  const adminResponse = NextResponse.json({});
  await admin.setAdminSessionCookie(adminResponse,request("/admin"),login.id,credential.passwordHash);
  const adminCookie = adminResponse.headers.get("set-cookie").split(";",1)[0];
  env.currentHeaders = new Headers({host:"njora.de",cookie:adminCookie});
  assert.equal(await admin.isAdminAuthenticated(),true);

  const recovery = await auth.requestPasswordReset(email);
  assert.ok(await changes.grantFor(toolRequest));
  const reset = await auth.resetPasswordWithToken(recovery.token,nextPassword);
  assert.ok(reset.token);
  assert.equal(await auth.resetPasswordWithToken(recovery.token,nextPassword),null);
  assert.equal(await changes.grantFor(toolRequest),null);
  assert.equal(await admin.isAdminAuthenticated(),false);
  assert.equal((await account.GET(request("/api/account","GET",null,cookie))).status,401);
  await assert.rejects(admin.setAdminSessionCookie(NextResponse.json({}),request("/admin"),login.id,credential.passwordHash));
  assert.ok((await billing.subscriber(login.id)).account_token);
  const newCookie = "__Host-njora_session="+reset.token;
  const newProfile = await (await account.GET(request("/api/account","GET",null,newCookie))).json();
  assert.equal(newProfile.plan.name,"edited");
  assert.equal(newProfile.revision,2);
  assert.equal(newProfile.user.accountCreatedAt,originalProfile.user.accountCreatedAt);
  assert.equal((await resetRoute.POST(request("/api/auth/reset-password","POST",{token:"invalid",password:nextPassword}))).status,400);
  assert.equal((await forgotRoute.POST(request("/api/auth/forgot-password","POST",{email}))).status,503);

  const operator = await auth.verifyPasswordAccount(email,nextPassword);
  const session = NextResponse.json({});
  await admin.setAdminSessionCookie(session, request("/admin"),login.id,operator.passwordHash);
  const signoutCookie = session.headers.get("set-cookie").split(";",1)[0];
  env.currentHeaders = new Headers({host:"njora.de",cookie:signoutCookie});
  await admin.clearAdminSessionCookie(NextResponse.json({}),request("/admin","POST",{},signoutCookie));
  assert.equal(await admin.isAdminAuthenticated(),false);

  assert.equal((await account.DELETE(request("/api/account","DELETE",undefined,newCookie))).status,200);
  for (const table of ["users","auth_credentials","auth_sessions","auth_action_tokens","finance_plans","business_plans","user_activity","njora_plugin_grants","njora_plugin_proposals","njora_subscribers"]) {
    assert.equal(db.sql.prepare("SELECT count(*) AS n FROM "+table).get().n,0,table);
  }
  assert.equal((await account.GET(request("/api/account","GET",null,newCookie))).status,401);
  await assert.rejects(billing.subscriber(login.id), /Abrechnungskonto fehlt/);
  const recreated = await auth.registerPasswordAccount(email,undefined,true);
  const replacement = await auth.confirmEmailVerification(recreated.verificationToken,password);
  const second = await (await account.GET(request("/api/account","GET",null,"__Host-njora_session="+replacement.token))).json();
  assert.equal(second.plan,null);
  assert.notEqual(second.user.accountCreatedAt,originalProfile.user.accountCreatedAt);
});

test("transactional email drives verification and a complete password reset using fictitious recipients", async t => {
  const db = database();
  t.after(() => db.sql.close());
  const email = "qa@example.invalid";
  const env = {DB:db, AUTH_PUBLIC_ORIGIN:origin, RESEND_API_KEY:"fixture", AUTH_EMAIL_FROM:"Njora <fixture@example.invalid>", AUTH_REQUIRE_EMAIL_VERIFICATION:"1"};
  const {auth,register,verify,forgotRoute,resetRoute} = await backend(env);
  const deliveries = [];
  let unavailable = false;
  t.mock.method(globalThis,"fetch",async(url,options) => {
    assert.equal(url,"https://api.resend.com/emails");
    assert.equal(options.redirect,"manual");
    const message = JSON.parse(options.body);
    assert.deepEqual(message.to,[email]);
    assert.match(options.headers["Idempotency-Key"],/^(verify_email|password_reset)-[0-9a-f]{32}$/);
    if (unavailable) return new Response(null,{status:503});
    const link = new URL(message.text.match(/https:\/\/[^\s]+/)[0]);
    assert.equal(link.origin,origin);
    assert.equal(link.search,"");
    deliveries.push(link);
    return Response.json({id:"fixture-message"});
  });
  const signup = await register.POST(request("/api/auth/register","POST",{email}));
  assert.equal(signup.status,202);
  assert.equal(deliveries[0].pathname,"/email-bestaetigen");
  const token = new URLSearchParams(deliveries[0].hash.slice(1)).get("token");
  const password = "first fixture password";
  assert.equal((await verify.POST(request("/api/auth/verify-email","POST",{token,password}))).status,200);
  assert.equal((await forgotRoute.POST(request("/api/auth/forgot-password","POST",{email}))).status,202);
  assert.equal(deliveries[1].pathname,"/passwort-zuruecksetzen");
  const resetToken = new URLSearchParams(deliveries[1].hash.slice(1)).get("token");
  assert.equal((await resetRoute.POST(request("/api/auth/reset-password","POST",{token:resetToken,password:"new fixture password"}))).status,200);
  assert.equal((await auth.loginPasswordAccount(email,password)).error,"invalid");
  assert.ok((await auth.loginPasswordAccount(email,"new fixture password")).token);
  unavailable = true;
  assert.equal((await forgotRoute.POST(request("/api/auth/forgot-password","POST",{email}))).status,503);
});

test("normal sessions, backup jobs and admin login keep separate credentials across the Vercel proxy", async t => {
  const {proxy} = await backend({});
  const upstream = [];
  t.mock.method(globalThis,"fetch",async(url,options) => {
    upstream.push({path:url.pathname, headers:options.headers});
    const login = url.pathname.endsWith("/login");
    return new Response("ok",{headers: login ? {"set-cookie": "__Host-njora_admin_session=demo; Path=/; HttpOnly; Secure"} : {}});
  });
  const cookies = "__Host-njora_session=user; __Host-njora_admin_session=admin; extra=irrelevant";
  const req = path => new Request(origin+path, {headers:{cookie:cookies,"x-njora-backup-token":"fixture-backup"}});
  await proxy.proxyApiRequest(req("/api/account"));
  await proxy.proxyApiRequest(req("/api/admin/backup"));
  const login = await proxy.proxyApiRequest(new Request(origin+"/api/admin/session/login",{method:"POST",headers:{origin},body:"{}"}));
  assert.equal(upstream[0].headers.get("cookie"),"__Host-njora_session=user");
  assert.equal(upstream[0].headers.get("x-njora-backup-token"),null);
  assert.equal(upstream[1].headers.get("cookie"),"__Host-njora_admin_session=admin");
  assert.equal(upstream[1].headers.get("x-njora-backup-token"),"fixture-backup");
  assert.match(login.headers.get("set-cookie"),/__Host-njora_admin_session=demo/);
});

test("a new backend can export a valid empty backup before any plan exists",async t => {
  const db = database();
  t.after(() => db.sql.close());
  const {backup} = await backend({DB:db,NJORA_BACKUP_EXPORT_TOKEN:"isolated-backup-token"});
  const req = new NextRequest(origin+"/api/admin/backup",{headers:{"x-njora-backup-token":"isolated-backup-token"}});
  const response = await backup.GET(req);
  assert.equal(response.status,200);
  assert.match(response.headers.get("cache-control"),/no-store/);
  const snapshot = await response.json();
  assert.equal(snapshot.version,1);
  assert.deepEqual(snapshot.tables,{users:[],auth_credentials:[],finance_plans:[],user_activity:[]});
});

test("a delayed cancellation for a previous account cannot delete a replacement account", async t => {
  const db = database();
  t.after(() => db.sql.close());
  const {auth,account,billing} = await backend({ DB:db, NJORA_STRIPE_SECRET:"fixture" });
  const email = "replacement@example.invalid";
  const register = async () => {
    const { token, id } = await auth.registerPasswordAccount(email,"fixture account password",false);
    return { cookie:"__Host-njora_session="+token, id };
  };
  const original = await register();
  await billing.subscriber(original.id);
  db.sql.prepare("UPDATE njora_subscribers SET stripe_customer='cus_fixture'").run();
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  let calls = 0;
  t.mock.method(globalThis,"fetch",async (url, options) => {
    assert.equal(new URL(url).pathname,"/v1/customers/cus_fixture");
    assert.equal(options.method,"DELETE");
    if (++calls === 1) { entered.resolve(); await resume.promise; }
    return Response.json({ object:"customer", id:"cus_fixture", deleted:true });
  });
  const remove = () => account.DELETE(request("/api/account","DELETE",undefined,original.cookie));
  const delayed = remove();
  await entered.promise;
  try {
    assert.equal((await remove()).status,200);
    const next = await register();
    const newSubscriber = await billing.subscriber(next.id);
    resume.resolve();
    assert.equal((await delayed).status,409);
    const current = await account.GET(request("/api/account","GET",null,next.cookie));
    assert.equal(current.status,200);
    assert.equal((await billing.subscriber(next.id)).account_token,newSubscriber.account_token);
  } finally { resume.resolve(); }
});

test("Stripe must confirm the linked customer's deletion before Njora deletes its account", async t => {
  const db = database();
  t.after(() => db.sql.close());
  const {auth, account, billing} = await backend({DB:db, NJORA_STRIPE_SECRET:"synthetic"});
  const {token, id} = await auth.registerPasswordAccount("cancellation@example.invalid", "synthetic first password", false);
  const cookie = "__Host-njora_session=" + token;
  await billing.subscriber(id);
  db.sql.prepare("UPDATE njora_subscribers SET stripe_customer='cus_test' WHERE user_id=?").run(id);
  const queue = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const [method, status, body] = queue.shift();
    assert.equal(url, "https://api.stripe.com/v1/customers/cus_test");
    assert.equal(options.method, method);
    assert.equal(options.redirect, "manual");
    return Response.json(body, {status});
  });
  const missing = {error:{code:"resource_missing"}};
  const deleted = {id:"cus_test", object:"customer", deleted:true};
  for (const responses of [
    [["DELETE",404,missing],["GET",404,missing]],
    [["DELETE",404,missing],["GET",200,{id:"cus_test", object:"customer"}]],
    [["DELETE",200,{...deleted,id:"other"}]],
    [["DELETE",200,{...deleted,object:"subscription"}]],
    [["DELETE",200,{...deleted,deleted:false}]],
    [["DELETE",403,{error:"restricted"}]],
  ]) {
    queue.push(...responses);
    const failed = await account.DELETE(request("/api/account","DELETE",undefined,cookie));
    assert.equal(failed.status,503);
    assert.equal((await failed.json()).code,"billing_cancellation_unconfirmed");
    assert.equal(queue.length,0);
    assert.equal(db.sql.prepare("SELECT stripe_customer FROM njora_subscribers WHERE user_id=?").get(id).stripe_customer,"cus_test");
    assert.ok(db.sql.prepare("SELECT id FROM users WHERE id=?").get(id));
  }
  queue.push(["DELETE",404,missing],["GET",200,deleted]);
  assert.equal((await account.DELETE(request("/api/account","DELETE",undefined,cookie))).status,200);
  assert.equal(queue.length,0);
  assert.equal(db.sql.prepare("SELECT id FROM users WHERE id=?").get(id),undefined);
});
