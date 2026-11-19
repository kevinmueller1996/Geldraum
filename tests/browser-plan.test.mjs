import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";
const source = (await readFile(new URL("../app/browser-plan.ts",import.meta.url),"utf8")).replace('import { markerName } from "./browser-session";','const markerName = () => "njora_browser";');
const compiled = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
const {mergeDraft,reconcile,pending,Conflict} = await import("data:text/javascript;base64,"+Buffer.from(compiled.outputText).toString("base64"));
const base={name:"Plan",expenses:[{id:"a",amount:2},{id:"b",amount:3}],snapshots:[]};
test("merge independent offline edits and deletions across devices",()=>{
  const local={...base,expenses:[{id:"a",amount:2}]};
  const cloud={...base,expenses:[{id:"a",amount:9},{id:"b",amount:3}]};
  assert.deepEqual(mergeDraft(base,local,cloud),{...base,expenses:[{id:"a",amount:9}]});
});
test("overlapping edits require a choice that preserves unrelated changes",()=>{
  const local={...base,name:"Local"}, cloud={...base,name:"Cloud",liquidity:50};
  assert.throws(()=>mergeDraft(base,local,cloud),Conflict);
  assert.deepEqual(mergeDraft(base,local,cloud,"device"),{...local,liquidity:50});
  assert.deepEqual(mergeDraft(base,local,cloud,"cloud"),cloud);
});
test("lost acknowledgement with subsequent undo is replayed exactly once",()=>{
  const sent={...base,name:"Sent"},remote={plan:{...sent,liquidity:40},revision:3};
  const copy=reconcile({plan:base,draft:base,sending:sent,revision:1,session:"s"},remote);
  assert.deepEqual(copy.draft,{...base,liquidity:40});assert.equal(pending(copy),true);
  assert.equal(pending(reconcile({...copy,sending:copy.draft},{plan:copy.draft,revision:4})),false);
});
test("concurrent check-ins on the same day cannot duplicate the date",()=>{
  const snapshot=id=>({...base,snapshots:[{id,date:"2026-11-18",balances:{},note:id}]});
  assert.throws(()=>mergeDraft(base,snapshot("1"),snapshot("2")),Conflict);
  assert.deepEqual(mergeDraft(base,snapshot("1"),snapshot("2"),"cloud"),snapshot("2"));
});
