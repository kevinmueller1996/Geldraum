import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { isLocalHostname } from "../../local-host";

export const dynamic = "force-dynamic";

type Identity = { email: string; displayName: string; local: boolean };

const USER_TABLE_SQL = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

const PLAN_TABLE_SQL = `CREATE TABLE IF NOT EXISTS finance_plans (
  user_id TEXT PRIMARY KEY NOT NULL,
  plan_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
)`;

const PLAN_UPDATED_INDEX_SQL = "CREATE INDEX IF NOT EXISTS finance_plans_updated_at_idx ON finance_plans(updated_at)";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function requestIdentity(request: NextRequest): Promise<Identity | null> {
  const authenticated = await getChatGPTUser();
  if (authenticated) return { email: authenticated.email.trim().toLowerCase(), displayName: authenticated.displayName, local: false };

  const hostname = new URL(request.url).hostname;
  if (isLocalHostname(hostname)) {
    return { email: "local-preview@geldraum.app", displayName: "Lokale Version", local: true };
  }

  return null;
}

async function userId(email: string) {
  const bytes = new TextEncoder().encode(email);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ensureSchema() {
  const db = env.DB;
  if (!db) throw new Error("D1 binding DB is unavailable");
  await db.batch([
    db.prepare(USER_TABLE_SQL),
    db.prepare(PLAN_TABLE_SQL),
    db.prepare(PLAN_UPDATED_INDEX_SQL),
  ]);
  return db;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isText(value: unknown, max = 160) {
  return typeof value === "string" && value.length <= max;
}

function isMoney(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000;
}

function validList(value: unknown, max: number, validator: (item: Record<string, unknown>) => boolean) {
  return Array.isArray(value) && value.length <= max && value.every((item) => isRecord(item) && validator(item));
}

function isPlan(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !isText(value.name, 80)) return false;
  return validList(value.incomes, 50, (item) => isText(item.id, 100) && isText(item.name, 120) && isMoney(item.amount) && typeof item.annual === "boolean" && (item.month === undefined || (Number.isInteger(item.month) && Number(item.month) >= 0 && Number(item.month) <= 11)))
    && validList(value.expenses, 250, (item) => isText(item.id, 100) && isText(item.name, 120) && isMoney(item.amount) && isText(item.category, 80) && (item.bookingDay === undefined || (Number.isInteger(item.bookingDay) && Number(item.bookingDay) >= 0 && Number(item.bookingDay) <= 31)))
    && validList(value.annualCosts, 100, (item) => isText(item.id, 100) && isText(item.name, 120) && isMoney(item.amount) && Number.isInteger(item.month) && Number(item.month) >= 0 && Number(item.month) <= 11)
    && validList(value.commitments, 100, (item) => isText(item.id, 100) && isText(item.name, 120) && isMoney(item.balance) && isMoney(item.payment))
    && validList(value.goals, 100, (item) => isText(item.id, 100) && isText(item.name, 120) && isMoney(item.target) && isMoney(item.saved))
    && validList(value.savings, 100, (item) => isText(item.id, 100) && isText(item.name, 120) && ["security", "dayMoney", "fixedDeposit", "buildingSavings", "cash", "other"].includes(String(item.kind)) && isMoney(item.balance)
      && (item.kind !== "security" || (isText(item.symbol, 30) && isMoney(item.quantity) && isMoney(item.price) && isMoney(item.priceEur) && isText(item.currency, 10) && (item.quoteUpdatedAt === undefined || isText(item.quoteUpdatedAt, 40)))))
    && validList(value.accounts, 30, (item) => isText(item.id, 100) && isText(item.name, 120) && (item.type === "bank" || item.type === "credit" || item.type === "cash") && isMoney(item.balance))
    && validList(value.snapshots, 500, (item) => isText(item.id, 100) && isText(item.date, 20) && isRecord(item.balances) && Object.values(item.balances).every(isMoney) && isText(item.note, 500) && (item.netBalance === undefined || isMoney(item.netBalance)));
}

async function upsertUser(identity: Identity) {
  const db = await ensureSchema();
  const id = await userId(identity.email);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO users (id, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`)
    .bind(id, identity.displayName, now, now).run();
  return { db, id, now };
}

export async function GET(request: NextRequest) {
  const identity = await requestIdentity(request);
  if (!identity) return json({ authenticated: false }, 401);

  try {
    const { db, id } = await upsertUser(identity);
    const result = await db.prepare("SELECT plan_json, revision, updated_at FROM finance_plans WHERE user_id = ?").bind(id).first<{ plan_json: string; revision: number; updated_at: string }>();
    return json({
      authenticated: true,
      user: { displayName: identity.displayName, email: identity.email, local: identity.local },
      plan: result ? JSON.parse(result.plan_json) : null,
      revision: result?.revision ?? null,
      updatedAt: result?.updated_at ?? null,
    });
  } catch {
    return json({ error: "Dein Konto konnte gerade nicht geladen werden." }, 503);
  }
}

export async function PUT(request: NextRequest) {
  if (!isSameOrigin(request)) return json({ error: "Unzulässige Anfrage." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "JSON erwartet." }, 415);
  const identity = await requestIdentity(request);
  if (!identity) return json({ authenticated: false }, 401);

  try {
    const body = await request.json() as { plan?: unknown; revision?: number | null };
    if (!isPlan(body.plan)) return json({ error: "Ungültiger Finanzplan." }, 400);
    const planJson = JSON.stringify(body.plan);
    if (new TextEncoder().encode(planJson).byteLength > 500_000) return json({ error: "Der Finanzplan ist zu groß." }, 413);

    const { db, id, now } = await upsertUser(identity);
    const existing = await db.prepare("SELECT revision FROM finance_plans WHERE user_id = ?").bind(id).first<{ revision: number }>();
    if (!existing) {
      await db.prepare("INSERT INTO finance_plans (user_id, plan_json, schema_version, revision, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?)")
        .bind(id, planJson, now, now).run();
      return json({ saved: true, revision: 1, updatedAt: now });
    }

    if (body.revision !== existing.revision) return json({ error: "Der Finanzplan wurde zwischenzeitlich auf einem anderen Gerät geändert.", revision: existing.revision }, 409);
    const nextRevision = existing.revision + 1;
    const result = await db.prepare("UPDATE finance_plans SET plan_json = ?, schema_version = 1, revision = ?, updated_at = ? WHERE user_id = ? AND revision = ?")
      .bind(planJson, nextRevision, now, id, existing.revision).run();
    if (!result.meta.changes) return json({ error: "Der Finanzplan wurde zwischenzeitlich geändert." }, 409);
    return json({ saved: true, revision: nextRevision, updatedAt: now });
  } catch {
    return json({ error: "Deine Änderungen konnten gerade nicht gespeichert werden." }, 503);
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSameOrigin(request)) return json({ error: "Unzulässige Anfrage." }, 403);
  const identity = await requestIdentity(request);
  if (!identity) return json({ authenticated: false }, 401);

  try {
    const db = await ensureSchema();
    const id = await userId(identity.email);
    await db.batch([
      db.prepare("DELETE FROM finance_plans WHERE user_id = ?").bind(id),
      db.prepare("DELETE FROM users WHERE id = ?").bind(id),
    ]);
    return json({ deleted: true });
  } catch {
    return json({ error: "Dein Konto konnte gerade nicht gelöscht werden." }, 503);
  }
}
