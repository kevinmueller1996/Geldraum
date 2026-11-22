import { env } from "cloudflare:workers";
import { billingEnabled, membership, subscriber } from "../billing/subscription";
import { McpUserError } from "./mcp";

export const db = () => env.DB;
let initialized: Promise<unknown> | undefined;

export function ensureTables() {
  const sql = [
    `CREATE TABLE IF NOT EXISTS njora_plugin_grants (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope TEXT NOT NULL, code_hash TEXT UNIQUE, challenge TEXT, code_until INTEGER,
      access_hash TEXT UNIQUE, access_until INTEGER, refresh_hash TEXT UNIQUE, expires INTEGER NOT NULL,
      credential_version TEXT NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS njora_plugin_users ON njora_plugin_grants(user_id)",
    `CREATE TABLE IF NOT EXISTS njora_plugin_proposals (
      id TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES njora_plugin_grants(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, actions TEXT NOT NULL, summary TEXT NOT NULL, expires INTEGER NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS njora_plugin_proposal_expiry ON njora_plugin_proposals(expires)"
  ];
  // Rebuild after a failed initialization so a temporary database outage is recoverable.
  return initialized ??= (async () => {
    for (const statement of sql) await db().prepare(statement).run();
  })().catch(error => {
    initialized = undefined;
    throw error;
  });
}

export async function activeAccount(userId: string) {
  return !billingEnabled(userId) || (await membership(await subscriber(userId))).active;
}
export async function currentPlan(userId: string) {
  if (!await activeAccount(userId)) throw new McpUserError("Für den Finanzplan ist ein aktiver Njora-Zugang erforderlich.");
  const row = await db().prepare("SELECT plan_json, revision FROM finance_plans WHERE user_id = ?")
    .bind(userId).first<{plan_json:string; revision:number}>();
  if (!row) throw new McpUserError("Lege zuerst deinen Finanzplan in Njora an.");
  return { plan: JSON.parse(row.plan_json), revision: row.revision };
}
export async function cleanup(now: number) {
  await db().batch([
    db().prepare("DELETE FROM njora_plugin_proposals WHERE expires <= ?").bind(now),
    db().prepare("DELETE FROM njora_plugin_grants WHERE expires <= ?").bind(now)
  ]);
}

