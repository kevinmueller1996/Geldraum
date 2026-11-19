import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";

const code = await build({entryPoints:["app/chatgpt/mcp.ts"], write:false, bundle:true, format:"esm", platform:"node", logLevel:"silent"});
const { handleMcp, McpUserError } = await import("data:text/javascript;base64," + Buffer.from(code.outputFiles[0].contents).toString("base64"));

const endpoint = "https://njora.de/api/chatgpt/mcp", meta = "https://njora.de/.well-known/oauth-protected-resource";
const plan = {name:"Test",accounts:[],annualCosts:[],commitments:[],expenses:[],goals:[],snapshots:[],savings:[],
  incomes:[{id:"salary",name:"Privater Klarname",amount:2700,annual:false}]};
const services = {
  resource:endpoint, metadataUrl:meta, authorize:async()=>({userId:"mine",scopes:["njora:read","njora:write"]}),
  readPlan:async id=>{assert.equal(id,"mine");return plan;},
  createProposal:async()=>{throw Error("not expected");}
};
const rpc = (method,params={})=>({jsonrpc:"2.0",id:1,method,params});
const req = (body,headers={})=>new Request(endpoint,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)});
const call = (name,args={})=>rpc("tools/call",{name,arguments:args});

test("negotiates stateless discovery for modern clients and legacy initialize",async()=>{
  const legacy = await handleMcp(req(rpc("initialize",{protocolVersion:"2025-11-25"})),services);
  assert.equal((await legacy.json()).result.protocolVersion,"2025-11-25");
  const version="2026-07-28", method="server/discover";
  const msg=rpc(method,{_meta:{"io.modelcontextprotocol/protocolVersion":version,"io.modelcontextprotocol/clientCapabilities":{}}});
  const headers={"mcp-protocol-version":version,"mcp-method":method};
  const res=await handleMcp(req(msg,headers),services);
  const body=await res.json();
  assert.ok(body.result.supportedVersions.includes(version));
  assert.equal(body.result.resultType,"complete");
  const mismatch=await handleMcp(req(msg,{...headers,"mcp-method":"tools/call"}),services);
  assert.equal(mismatch.status,400);
  assert.equal((await mismatch.json()).error.code,-32020);
  const unsupported=await handleMcp(req(msg,{...headers,"mcp-protocol-version":"2029-01-01"}),services);
  assert.equal((await unsupported.json()).error.code,-32022);
});

test("challenges unauthenticated users and requests write permission before creating a preview",async()=>{
  let called=false;
  const svc={...services,authorize:async()=>null,createProposal:async()=>{called=true;}};
  const res=await handleMcp(req(rpc("tools/list")),svc);
  assert.equal(res.status,401);
  assert.match(res.headers.get("www-authenticate"),/resource_metadata/);
  const denied=await handleMcp(req(call("prepare_plan_changes",{actions:[]})),{
    ...svc,authorize:async()=>({userId:"mine",scopes:["njora:read"]})});
  const result=(await denied.json()).result;
  assert.equal(result.isError,true);
  assert.match(result._meta["mcp/www_authenticate"][0],/insufficient_scope/);
  assert.match(result._meta["mcp/www_authenticate"][0],/njora:write/);
  assert.equal(called,false);
});

test("returns minimized results in EUR and rejects hidden authority or extraneous arguments",async()=>{
  for(const name of ["get_month_summary","get_upcoming_payments","simulate_monthly_expense"]){
    const out=await handleMcp(req(call(name,name==="simulate_monthly_expense"?{monthlyDelta:40}:{})),services);
    assert.equal(out.status,200);
    const result=(await out.json()).result;
    assert.equal(result.structuredContent.currency,"EUR");
    if(name==="get_month_summary") assert.ok(!JSON.stringify(result).includes("Privater Klarname"));
    if(name==="simulate_monthly_expense") assert.equal(result.structuredContent.simulatedMonthlyAvailable,2660);
  }
  const bad=await handleMcp(req(call("get_month_summary",{userId:"other"})),{
    ...services,readPlan:async()=>{assert.fail("must not access any plan");}
  });
  assert.equal((await bad.json()).result.isError,true);
  const error=await handleMcp(req(call("get_month_summary")),{...services,readPlan:async()=>{throw Error("private backend diagnostics");}});
  assert.ok(!(await error.text()).includes("private backend diagnostics"));
  const missing=await handleMcp(req(call("get_month_summary")),{...services,readPlan:async()=>{throw new McpUserError("Kein Finanzplan vorhanden.");}});
  assert.equal((await missing.json()).result.content[0].text,"Kein Finanzplan vorhanden.");
});

test("exposes no commit tool and scopes confirmation URLs to a proposal belonging to the signed-in user",async()=>{
  const list=await handleMcp(req(rpc("tools/list")),services);
  const defs=(await list.json()).result.tools;
  assert.deepEqual(defs.map(t=>t.name),["get_month_summary","get_upcoming_payments","simulate_monthly_expense","prepare_plan_changes"]);
  const writes=defs.filter(t=>!t.annotations.readOnlyHint);
  assert.equal(writes.length,1);
  const actions=[{type:"invoice",name:"Reparatur",amount:72,dueDate:"2027-05-10"}];
  const preview=await handleMcp(req(call("prepare_plan_changes",{actions})),{
    ...services,createProposal:async(id,a)=>{assert.equal(id,"mine");assert.deepEqual(a,actions);
      return {confirmationUrl:"https://njora.de/review/test",summary:"72 Euro",expiresAt:"2027-01-03T12:00:00Z"};}
  });
  assert.equal((await preview.json()).result.structuredContent.status,"awaiting_confirmation");
  for(const name of ["commit_plan_changes","transfer_money"]){
    const unknown=await handleMcp(req(call(name)),services);
    assert.equal((await unknown.json()).error.code,-32602);
  }
});

test("bounds incoming bodies and rejects unexpected origins before authentication",async()=>{
  const big=await handleMcp(req(rpc("tools/call",{data:"x".repeat(40000)})),services);
  assert.equal(big.status,413);
  const forbidden=await handleMcp(req(rpc("tools/list"),{origin:"https://example.org"}),{...services,authorize:async()=>assert.fail()});
  assert.equal(forbidden.status,403);
});

test("submission package points at the service and has the eight requested directory review cases",async()=>{
  const root=new URL("../plugins/njora/",import.meta.url);
  const manifest=JSON.parse(await readFile(new URL("plugin.json",root),"utf8"));
  const mcp=JSON.parse(await readFile(new URL("mcp.json",root),"utf8"));
  const {review,interface:ui}=manifest.extensions["com.openai"];
  assert.equal(review.test_cases.positive.length,5);assert.equal(review.test_cases.negative.length,3);
  assert.ok(ui.shortDescription.length<=30);assert.equal(mcp.mcpServers.njora.url,endpoint);
  assert.deepEqual([...await readFile(new URL(ui.logo,root))].slice(0,8),[137,80,78,71,13,10,26,10]);
});
