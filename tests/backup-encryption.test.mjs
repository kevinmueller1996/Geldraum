import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createBackup, restoreBackup } from "../scripts/njora-backup.mjs";

function testKeys() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
}

const timestamp = "2026-11-01T17:00:00Z";
const name = "Synthetischer Wiederherstellungstest";
const plan = { name, incomes: [], expenses: [], annualCosts: [], commitments: [], accounts: [], goals: [], snapshots: [] };
const data = { format: "njora-database-backup", version: 2, tables: {
  users: [{ id: "u1", display_name: name, created_at: timestamp, updated_at: timestamp }],
  finance_plans: [{ user_id: "u1", schema_version: 1, revision: 2, plan_json: JSON.stringify(plan), created_at: timestamp, updated_at: timestamp }],
  auth_credentials: [], user_activity: [],
  njora_subscribers: [{ user_id: "u1", account_token: "synthetic", stripe_customer: null, apple_original: null, apple_environment: null }],
} };

test("verschlüsselter Export: atomar, authentisiert, mit synthetischem Inhalt bis SQLite wiederherstellbar", async t => {
  const target = await mkdtemp(join(tmpdir(), "njora-encrypted-backup-"));
  t.after(() => rm(target, { recursive: true, force: true }));
  const { publicKey, privateKey } = testKeys();
  const mock = async (url, options) => {
    assert.equal(url, "https://njora.de/api/admin/backup");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers["x-njora-backup-token"], "synthetic-export-token");
    return Response.json(data);
  };
  await assert.rejects(createBackup(target, publicKey, "", mock));
  await assert.rejects(createBackup(target, privateKey, "synthetic", mock));
  for (const response of [
    () => Response.json({error: "secret-error-content"}, {status: 403}),
    () => new Response("<html>Login</html>"),
    () => Response.json({...data, tables: {users: []}}),
    () => new Response("{", {headers: {"content-type": "application/json"}}),
  ]) {
    await assert.rejects(createBackup(target, publicKey, "synthetic", response));
  }
  assert.deepEqual(await readdir(target), []);
  const [first, second] = await Promise.all([1, 2].map(() => createBackup(target, publicKey, "synthetic-export-token", mock)));
  assert.notEqual(first, second);
  assert.equal((await readdir(target)).length, 2);
  assert.equal((await stat(first)).mode & 0o777, 0o600);
  const raw = await readFile(first, "utf8");
  assert.ok(!raw.includes(name));
  assert.ok(!raw.includes("synthetic-export-token"));
  assert.notEqual(raw, await readFile(second, "utf8"));
  const output = join(target, "recovered.sqlite");
  await assert.rejects(restoreBackup(first, testKeys().privateKey, output));
  const altered = JSON.parse(raw);
  const ciphertext = Buffer.from(altered.ciphertext, "base64");
  ciphertext[ciphertext.length - 1] ^= 1;
  altered.ciphertext = ciphertext.toString("base64");
  const alteredFile = join(target, "altered.enc");
  await writeFile(alteredFile, JSON.stringify(altered));
  await assert.rejects(restoreBackup(alteredFile, privateKey, output));
  await assert.rejects(stat(output), {code: "ENOENT"});
  await restoreBackup(first, privateKey, output);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  const check = spawnSync("python3", ["-c", [
    "import json, sqlite3, sys",
    "with sqlite3.connect(sys.argv[1]) as db:",
    " assert db.execute('PRAGMA integrity_check').fetchone()==('ok',)",
    " assert not db.execute('PRAGMA foreign_key_check').fetchall()",
    " assert db.execute('SELECT display_name FROM users').fetchone()[0]==sys.argv[2]",
    " assert json.loads(db.execute('SELECT plan_json FROM finance_plans').fetchone()[0])['name']==sys.argv[2]",
    " assert db.execute('SELECT account_token FROM njora_subscribers').fetchone()[0]=='synthetic'",
  ].join("\n"), output, name], {encoding: "utf8"});
  assert.equal(check.status, 0, check.stderr);
  const good = await readFile(output);
  await assert.rejects(restoreBackup(first, privateKey, output));
  assert.deepEqual(await readFile(output), good);
});
