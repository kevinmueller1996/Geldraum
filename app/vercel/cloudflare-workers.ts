import "server-only";

type Query = { sql: string; params: unknown[] };
type ApiResult = D1Result<Record<string, unknown>>;
type ApiEnvelope = {
  success: boolean;
  errors?: Array<{ message?: string }>;
  result?: ApiResult[];
};

function required(name: "CLOUDFLARE_ACCOUNT_ID" | "CLOUDFLARE_D1_DATABASE_ID" | "CLOUDFLARE_D1_API_TOKEN") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing Vercel environment variable ${name}`);
  return value;
}

async function queryD1(queries: Query[]) {
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  const databaseId = required("CLOUDFLARE_D1_DATABASE_ID");
  const token = required("CLOUDFLARE_D1_API_TOKEN");
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(queries.length === 1 ? queries[0] : { batch: queries }),
    cache: "no-store",
  });
  const payload = await response.json() as ApiEnvelope;
  if (!response.ok || !payload.success || !payload.result?.every((item) => item.success)) {
    const message = payload.errors?.map((item) => item.message).filter(Boolean).join("; ") || `Cloudflare D1 request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload.result;
}

class RemoteD1Statement implements D1PreparedStatement {
  private params: unknown[] = [];

  constructor(readonly sql: string) {}

  bind(...values: unknown[]) {
    this.params = values;
    return this;
  }

  toQuery(): Query {
    return { sql: this.sql, params: this.params };
  }

  async run<T = Record<string, unknown>>() {
    return (await queryD1([this.toQuery()]))[0] as D1Result<T>;
  }

  async first<T = Record<string, unknown>>(columnName?: string) {
    const result = await this.all<T>();
    const row = result.results[0] ?? null;
    if (!row || !columnName) return row;
    return (row as Record<string, unknown>)[columnName] as T ?? null;
  }

  async all<T = Record<string, unknown>>() {
    return (await queryD1([this.toQuery()]))[0] as D1Result<T>;
  }
}

class RemoteD1Database implements D1Database {
  prepare(sql: string) {
    return new RemoteD1Statement(sql);
  }

  async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]) {
    const queries = statements.map((statement) => {
      if (!(statement instanceof RemoteD1Statement)) throw new Error("Invalid remote D1 statement");
      return statement.toQuery();
    });
    return await queryD1(queries) as D1Result<T>[];
  }
}

const database = new RemoteD1Database();

export const env = new Proxy({ DB: database } as { DB: D1Database; [key: string]: unknown }, {
  get(target, property) {
    if (property === "DB") return target.DB;
    return typeof property === "string" ? process.env[property] : undefined;
  },
});
