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
      export * as sharing from "./app/api/sharing/route";
      export * as register from "./app/api/auth/register/route";
      export * as verify from "./app/api/auth/verify-email/route";
      export * as auth from "./app/password-auth";
      export * as apple from "./app/api/auth/apple/route";
      export * as appleStart from "./app/api/auth/apple/start/route";
      export * as appleCallback from "./app/api/auth/apple/callback/route";
      export * as appleNotifications from "./app/api/auth/apple/notifications/route";
      export * as alias from "./app/api/auth/alias/route";
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
  assert.equal(originalProfile.user.dashboardBasis, "gross");
  const preference = (dashboardBasis, session) => account.PATCH(request("/api/account", "PATCH", {dashboardBasis}, session));
  assert.equal((await preference("net", "")).status, 401);
  assert.equal((await preference("invalid", cookie)).status, 400);
  assert.equal((await preference("net", cookie)).status, 200);
  const reloaded = await (await account.GET(request("/api/account/business", "GET", null, cookie))).json();
  assert.equal(reloaded.user.dashboardBasis, "net");
  assert.equal(reloaded.revision, null);
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
  assert.equal(fresh.otherWorkspaceName,"edited");
  assert.equal((await putBusiness(null,"Unternehmen")).status,200);
  assert.equal((await putBusiness(null,"Duplikat")).status,409);
  assert.equal((await putBusiness(1,"Firmenplan")).status,200);
  assert.equal((await putBusiness(1,"Veraltete Firmenrevision")).status,409);
  assert.equal((await (await getBusiness(cookie)).json()).plan.name,"Firmenplan");
  const personal = await (await account.GET(request("/api/account","GET",null,cookie))).json();
  assert.equal(personal.plan.name,"edited");
  assert.equal(personal.otherWorkspaceName,"Firmenplan");

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

test("sharing binds each grant to one verified recipient, owner, role and workspace", async t => {
  const db = database();
  t.after(()=>db.sql.close());
  const env = {DB:db, AUTH_REQUIRE_EMAIL_VERIFICATION:"1"};
  const {auth,account,sharing,billing} = await backend(env);
  const session = async name => {
    const email = name+"@example.invalid";
    const pending = await auth.registerPasswordAccount(email,undefined,true);
    const result = await auth.confirmEmailVerification(pending.verificationToken,"example secure fixture");
    return "__Host-njora_session="+result.token;
  };
  const owner = await session("owner"), partner = await session("partner"), spouse = await session("spouse");
  const call = (cookie,workspace,action,fields={},method="POST") => sharing[method](request("/api/sharing",method,{workspace,action,...fields},cookie));
  const grants = async (cookie,space) => (await call(cookie,space,"list")).json();
  const write = (c,space,id,revision,name) => call(c,space,"plan",{id,revision,plan:{...example,name}},"PUT");
  for (const [path,cookie,name] of [["/api/account",owner,"Privat"],["/api/account/business",owner,"Firma"],["/api/account",partner,"Mein eigener Plan"]]) {
    assert.equal((await account.PUT(request(path,"PUT",{revision:null,plan:{...example,name}},cookie))).status,200);
  }
  assert.equal((await call("","private","list")).status,401);
  assert.equal((await call(owner,"both","invite",{email:"spouse@example.invalid",role:"view"})).status,400);
  assert.equal((await call(owner,"private","invite",{email:"owner@example.invalid",role:"edit"})).status,400);
  for(const [space,name,role] of [["private","spouse","view"],["business","partner","edit"]]) {
    const invite = await call(owner,space,"invite",{email:name+"@example.invalid",role});
    assert.equal(invite.status,200);
    assert.equal((await invite.json()).mailed,false);
  }
  const {id:personal} = (await grants(spouse,"private")).received[0];
  const {id:business} = (await grants(partner,"business")).received[0];
  assert.deepEqual((await grants(spouse,"business")).received,[]);
  assert.deepEqual((await grants(partner,"private")).received,[]);
  assert.equal((await call(spouse,"private","plan",{id:personal})).status,404);
  assert.equal((await call(partner,"private","accept",{id:personal})).status,404);
  assert.equal((await call(spouse,"private","accept",{id:personal})).status,200);
  assert.equal((await call(partner,"business","accept",{id:business})).status,200);
  assert.equal((await call(partner,"private","plan",{id:business})).status,404);
  assert.equal((await call(partner,"private","plan",{id:personal})).status,404);
  assert.equal((await (await call(spouse,"private","plan",{id:personal})).json()).plan.name,"Privat");
  assert.equal((await account.PATCH(request("/api/account","PATCH",{dashboardBasis:"net"},partner))).status,200);
  assert.equal((await (await call(partner,"business","plan",{id:business})).json()).dashboardBasis,"net");
  assert.equal((await (await account.GET(request("/api/account/business","GET",null,owner))).json()).user.dashboardBasis,"gross");
  assert.equal((await write(spouse,"private",personal,1,"Changed")).status,403);
  assert.equal((await write(partner,"business",business,1,"Firma aktualisiert")).status,200);
  assert.equal((await write(partner,"business",business,1,"Veraltet")).status,409);
  assert.equal((await (await account.GET(request("/api/account/business","GET",null,owner))).json()).plan.name,"Firma aktualisiert");
  assert.equal((await (await account.GET(request("/api/account","GET",null,partner))).json()).plan.name,"Mein eigener Plan");
  // Enable billing after the grants exist. Only the owner's company subscription funds the shared company plan.
  Object.assign(env,{NJORA_BILLING_ENABLED:"true",NJORA_STRIPE_PRICE:"price_private",NJORA_STRIPE_BUSINESS_PRICE:"price_company",NJORA_STRIPE_SECRET:"fixture"});
  const ownerId = await auth.userId("owner@example.invalid");
  const companySubscriber = await billing.subscriber(ownerId,undefined,"business");
  assert.notEqual(companySubscriber.account_token,(await billing.subscriber(ownerId)).account_token);
  db.prepare("UPDATE njora_business_subscribers SET stripe_customer=? WHERE user_id=?").bind("cus_company",ownerId).run();
  const transport = t.mock.method(globalThis,"fetch",async url=>{
    const endpoint = new URL(url);
    assert.equal(endpoint.pathname,"/v1/subscriptions");
    assert.equal(endpoint.searchParams.get("customer"),"cus_company");
    return Response.json({data:[{status:"active",items:{data:[{price:{id:"price_company"}}]}}]});
  });
  assert.equal((await call(partner,"business","plan",{id:business})).status,200);
  assert.equal((await write(partner,"business",business,2,"Firma gemeinsam")).status,200);
  assert.equal((await call(spouse,"private","plan",{id:personal})).status,402);
  assert.equal(db.prepare("SELECT count(*) AS n FROM njora_business_subscribers WHERE user_id<>?").bind(ownerId).first().n,0);
  assert.equal((await account.PUT(request("/api/account/business","PUT",{plan:example,revision:null},partner))).status,402);
  db.prepare("UPDATE njora_business_subscribers SET stripe_customer=NULL WHERE user_id=?").bind(ownerId).run();
  assert.equal((await call(partner,"business","plan",{id:business})).status,402);
  delete env.NJORA_BILLING_ENABLED;
  transport.mock.restore();
  assert.equal((await call(owner,"business","remove",{id:business})).status,200);
  assert.equal((await call(partner,"business","plan",{id:business})).status,404);
  assert.equal((await write(partner,"business",business,2,"Nach Widerruf")).status,404);
  assert.equal((await call(owner,"business","invite",{email:"spouse@example.invalid",role:"edit"})).status,200);
  const pending = (await grants(spouse,"business")).received[0].id;
  db.prepare("UPDATE workspace_shares SET expires_at='2000-01-01' WHERE id=?").bind(pending).run();
  assert.equal((await call(spouse,"business","accept",{id:pending})).status,404);
  assert.equal((await account.DELETE(request("/api/account","DELETE",null,spouse))).status,200);
  const fresh = await session("spouse");
  assert.deepEqual((await grants(fresh,"private")).received,[]);
  assert.equal((await call(fresh,"private","plan",{id:personal})).status,404);
});

test("Apple sign-in preserves account identity across clients, protects linking and serves verified invitations", async t => {
  const db = database();
  t.after(() => db.sql.close());
  const proofKey = await crypto.subtle.generateKey({name:"ECDSA", namedCurve:"P-256"}, true, ["sign","verify"]);
  const appleKey = await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5", modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]), hash:"SHA-256"}, true, ["sign", "verify"]);
  const pem = Buffer.from(await crypto.subtle.exportKey("pkcs8", proofKey.privateKey)).toString("base64");
  const jwk = {...await crypto.subtle.exportKey("jwk", appleKey.publicKey), kid:"fixture-apple", alg:"RS256"};
  const env = {DB:db, AUTH_REQUIRE_EMAIL_VERIFICATION:"1", AUTH_APPLE_ENABLED:"1",
    AUTH_APPLE_TEAM_ID:"TEAMFIXTURE", AUTH_APPLE_KEY_ID:"KEYFIXTURE",
    AUTH_APPLE_PRIVATE_KEY:pem, AUTH_APPLE_WEB_CLIENT_ID:"de.njora.web", AUTH_APPLE_TOKEN_KEY:Buffer.alloc(32, 1).toString("base64url"),
    RESEND_API_KEY:"fixture", AUTH_EMAIL_FROM:"test@example.invalid"};
  const {auth, apple, appleStart, appleCallback, appleNotifications, alias, account, sharing} = await backend(env);
  const responses = new Map();
  const revoked = [];
  let mailCode;
  const originalFetch = globalThis.fetch;
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issuer = "https://appleid.apple.com";
  const sign = async claims => {
    const body = encode({alg:"RS256", kid:jwk.kid}) + "." + encode(claims);
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", appleKey.privateKey, new TextEncoder().encode(body));
    return body + "." + Buffer.from(sig).toString("base64url");
  };
  globalThis.fetch = async (url, init) => {
    switch (String(url)) {
      case issuer + "/auth/keys": return Response.json({keys:[jwk]});
      case issuer + "/auth/token": {
        const form = init.body;
        const entry = responses.get(form.get("code"));
        if (!entry) return new Response(null, {status:400});
        responses.delete(form.get("code"));
        const iat = Math.floor(Date.now()/1000);
        assert.equal(form.get("client_id"), entry.client);
        if (entry.client === env.AUTH_APPLE_WEB_CLIENT_ID) assert.equal(form.get("redirect_uri"), origin + "/api/auth/apple/callback");
        return Response.json({id_token:await sign({iss:issuer, sub:entry.sub, aud:entry.audience ?? entry.client, iat, exp:iat+300,
          nonce:entry.nonce, email:entry.email, email_verified:true}), refresh_token:"fixture-refresh-" + entry.sub});
      }
      case issuer + "/auth/revoke":
        revoked.push(init.body.get("token"));
        return new Response(null, {status:200});
      case "https://api.resend.com/emails":
        mailCode = JSON.parse(init.body).text.match(/lautet: ([A-Za-z0-9_-]{16})/)?.[1] ?? mailCode;
        return Response.json({id:"fixture"});
      default: throw new Error("Unexpected test request " + url);
    }
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const route = (body, cookie = "") => request("/api/auth/apple", "POST", body, cookie);
  const cookie = response => response.headers.get("set-cookie")?.match(/__Host-njora_session=[^;]+/)?.[0];
  const webForm = (path, body, cookie = "", from = origin) => new NextRequest(origin + path, {
    method:"POST", headers:{origin:from, cookie}, body:new URLSearchParams(body)
  });
  const native = async (purpose, code, entry, accountCookie = "") => {
    const response = await apple.POST(route({action:"begin", purpose}, accountCookie));
    assert.equal(response.status, 200);
    const {state, nonce} = await response.json();
    responses.set(code, {client:"de.njora.finanzueberblick", nonce, ...entry});
    const fields = {action:"finish", state, code};
    const finished = await apple.POST(route(fields, accountCookie));
    assert.equal((await apple.POST(route(fields, accountCookie))).status, 400);
    return finished;
  };

  const password = "existing fixture password";
  const ownerEmail = "owner@example.invalid";
  const pending = await auth.registerPasswordAccount(ownerEmail, undefined, true);
  const verified = await auth.confirmEmailVerification(pending.verificationToken, password);
  const ownerCookie = "__Host-njora_session=" + verified.token;
  const existing = {sub:"existing-subject", email:ownerEmail};
  assert.equal((await native("register","collision",existing)).status, 409);
  assert.equal((await native("login","not-linked",existing)).status, 409);
  assert.equal((await native("register","wrong-audience",{...existing,audience:"wrong-client"})).status, 503);
  assert.equal((await native("link","linked",existing,ownerCookie)).status, 200);

  const start = await appleStart.POST(webForm("/api/auth/apple/start", {purpose:"login", continue:"/freigaben?bereich=business"}));
  const url = new URL(start.headers.get("location"));
  assert.equal(url.origin, issuer);
  const browser = start.headers.get("set-cookie").split(";")[0];
  const state = url.searchParams.get("state");
  responses.set("web-login", {client:env.AUTH_APPLE_WEB_CLIENT_ID, ...existing, nonce:url.searchParams.get("nonce")});
  const callback = browser => appleCallback.POST(webForm("/api/auth/apple/callback", {state, code:"web-login"}, browser, issuer));
  assert.match((await callback("")).headers.get("location"), /apple_expired/);
  const entered = await callback(browser);
  assert.equal(entered.headers.get("location"), origin + "/freigaben?bereich=business");
  assert.equal((await auth.getSessionIdentity(request("/", "GET", null, cookie(entered)))).id, pending.id);

  const relay = "relay@privaterelay.appleid.com";
  const newApple = await native("register","new",{sub:"new-subject",email:relay});
  assert.equal(newApple.status, 200);
  const newCookie = cookie(newApple);
  const recipient = await auth.getSessionIdentity(request("/", "GET", null, newCookie));
  assert.equal(recipient.email, relay);
  assert.equal((await auth.loginPasswordAccount(ownerEmail, password)).id, pending.id);
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM users").get().n, 2);

  const invitedEmail = "invitation@example.invalid";
  const share = (data, session) => sharing.POST(request("/api/sharing","POST",{workspace:"private",...data},session));
  assert.equal((await share({action:"invite",email:invitedEmail,role:"view"},ownerCookie)).status, 200);
  assert.deepEqual((await (await share({action:"list"},newCookie)).json()).received, []);
  const aliasAction = (data, session) => alias.POST(request("/api/auth/alias","POST",data,session));
  assert.equal((await aliasAction({action:"send",email:invitedEmail},newCookie)).status, 200);
  assert.ok(mailCode);
  assert.equal((await aliasAction({action:"verify",code:mailCode},ownerCookie)).status, 400);
  assert.equal((await aliasAction({action:"verify",code:mailCode},newCookie)).status, 200);
  assert.equal((await aliasAction({action:"verify",code:mailCode},newCookie)).status, 400);
  assert.equal((await auth.registerPasswordAccount(invitedEmail, undefined, true)).error, "exists");
  const received = (await (await share({action:"list"},newCookie)).json()).received;
  assert.equal(received.length, 1);
  assert.equal((await share({action:"accept",id:received[0].id},newCookie)).status, 200);

  const issuedAt = Math.floor(Date.now()/1000);
  const payload = await sign({iss:issuer, aud:"de.njora.finanzueberblick", iat:issuedAt,
    events:{type:"consent-revoked",sub:"existing-subject",event_time:issuedAt}});
  assert.equal((await appleNotifications.POST(request("/api/auth/apple/notifications","POST",{payload}))).status, 200);
  assert.equal(await auth.getSessionIdentity(request("/", "GET", null, cookie(entered))), null);
  assert.equal((await auth.loginPasswordAccount(ownerEmail, password)).id, pending.id);

  const deletion = await account.DELETE(request("/api/account","DELETE",null,newCookie));
  assert.equal(deletion.status, 200);
  assert.deepEqual(revoked, ["fixture-refresh-new-subject"]);
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM auth_email_aliases").get().n, 0);
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM workspace_shares").get().n, 0);
});
