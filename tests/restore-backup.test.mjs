import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("disaster recovery restores legacy and subscription backups and refuses broken or occupied targets", async t => {
  const directory = await mkdtemp(join(tmpdir(), "njora-restore-test-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const source = join(directory, "backup.json");
  const restore = (target) => spawnSync("python3", ["scripts/restore-njora-backup.py", source, target], {encoding:"utf8"});
  const time = "2026-11-01T00:00:00Z";
  const plan = {name:"Beispiel",accounts:[],incomes:[],expenses:[],annualCosts:[],goals:[],commitments:[],snapshots:[]};
  const tables = {users:[{id:"u",display_name:"Test",created_at:time,updated_at:time}],finance_plans:[
    {user_id:"u",plan_json:JSON.stringify(plan),revision:2,schema_version:1,created_at:time,updated_at:time}
  ],user_activity:[],auth_credentials:[]};
  const backup = {format:"njora-database-backup",version:1,tables};
  const target = join(directory,"v1.sqlite");
  await writeFile(source,JSON.stringify(backup));
  assert.equal(restore(target).status,0);
  assert.equal((await stat(target)).mode & 0o777,0o600);
  const original = await readFile(target);
  assert.notEqual(restore(target).status,0);
  assert.deepEqual(await readFile(target),original);
  tables.njora_subscribers = [{user_id:"u",account_token:"demo",stripe_customer:null,apple_original:null,apple_environment:null}];
  backup.version = 2;
  await writeFile(source,JSON.stringify(backup));
  assert.equal(restore(join(directory,"v2.sqlite")).status,0);
  backup.version = 3;
  tables.business_plans = [{...tables.finance_plans[0], plan_json:JSON.stringify({...plan, name:"Firma"})}];
  await writeFile(source,JSON.stringify(backup));
  assert.equal(restore(join(directory,"v3.sqlite")).status,0);
  for (const bad of ["orphan","invalid-plan"]) {
    if (bad === "orphan") tables.njora_subscribers[0].user_id = "missing";
    else {tables.njora_subscribers[0].user_id = "u"; tables.finance_plans[0].plan_json = "{}";}
    const broken = join(directory,bad+".sqlite");
    await writeFile(source,JSON.stringify(backup));
    assert.notEqual(restore(broken).status,0);
    await assert.rejects(stat(broken),{code:"ENOENT"});
  }
});
