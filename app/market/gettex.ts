type Instrument = {
  symbol: string;
  providerSymbol: string;
  localSymbol: string;
  name: string;
  exchange: "MUNC" | "MUND";
  type: "Aktie" | "ETF" | "Fonds";
};

type MarketConfig = { profiles: URL; events: URL; authorization: string };
type Trade = { eventSymbol?: unknown; price?: unknown; time?: unknown };

export const marketProvider = "gettex via dxFeed";
export const marketUnavailable = "gettex-Kurse sind gerade nicht verfügbar.";
export const gettexSymbol = /^GTX:[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

function setting(env: Record<string, unknown>, key: string) {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

export function hasGettexSettings(env: Record<string, unknown>) {
  return ["NJORA_DXFEED_GETTEX_IPF_URL", "NJORA_DXFEED_GETTEX_EVENTS_URL", "NJORA_DXFEED_AUTHORIZATION"]
    .some((key) => Boolean(setting(env, key)));
}

function providerUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".dxfeed.com")
    || url.username || url.password || url.hash || url.port) throw new Error("Invalid dxFeed URL");
  return url;
}

export function marketConfig(env: Record<string, unknown>): MarketConfig {
  const profiles = providerUrl(setting(env, "NJORA_DXFEED_GETTEX_IPF_URL"));
  const events = providerUrl(setting(env, "NJORA_DXFEED_GETTEX_EVENTS_URL"));
  const authorization = setting(env, "NJORA_DXFEED_AUTHORIZATION");
  if (!/^(?:Basic [A-Za-z0-9+/]+=*|Bearer [!-~]+)$/.test(authorization)) {
    throw new Error("Missing or invalid dxFeed authorization");
  }
  return { profiles, events, authorization };
}

function csvFields(line: string) {
  const fields = line.match(/(?:^|,)(?:"(?:[^"]|"")*"|[^",]*)/g) ?? [];
  if (fields.join("") !== line) return [];
  return fields.map((field, index) => {
    const value = index ? field.slice(1) : field;
    return value.startsWith('"') ? value.slice(1, -1).replace(/""/g, '"') : value;
  });
}

function instrumentType(type: string, cfi: string): Instrument["type"] | undefined {
  if (type === "ETF" || cfi.startsWith("CE")) return "ETF";
  if (type === "MUTUAL_FUND" || type === "FUND" || cfi.startsWith("C")) return "Fonds";
  if (type === "STOCK") return "Aktie";
}

export function parseProfiles(profile: string) {
  if (!/(?:^|\n)##COMPLETE$/.test(profile.trimEnd())) throw new Error("Incomplete dxFeed profile snapshot");
  const headers = new Map<string, string[]>();
  const rows = new Map<string, Instrument>();
  const byProviderSymbol = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const line of profile.split(/\r?\n/)) {
    const fields = csvFields(line.trim());
    const header = /^#([A-Z_]+)::=TYPE$/.exec(fields[0] ?? "");
    if (header) {
      headers.set(header[1], fields);
      continue;
    }
    const columns = headers.get(fields[0]);
    if (!columns || fields.length !== columns.length) continue;
    const value = (column: string) => fields[columns.indexOf(column)]?.trim() ?? "";
    const symbol = `GTX:${value("ISIN").toUpperCase()}`;
    const providerSymbol = value("SYMBOL");
    const type = instrumentType(fields[0], value("CFI"));
    const venues = [value("OPOL"), ...value("EXCHANGES").split(";")];
    const exchange = venues.includes("MUNC") ? "MUNC" : venues.includes("MUND") ? "MUND" : undefined;
    if (!gettexSymbol.test(symbol) || !providerSymbol || /[,\x00-\x1f]/.test(providerSymbol)
      || value("CURRENCY") !== "EUR" || !exchange || !type) continue;

    const knownSymbol = byProviderSymbol.get(providerSymbol);
    if (knownSymbol && knownSymbol !== symbol) {
      ambiguous.add(knownSymbol);
      ambiguous.add(symbol);
    }
    const previous = rows.get(symbol);
    if (previous && (previous.providerSymbol !== providerSymbol || previous.exchange !== exchange)) ambiguous.add(symbol);
    byProviderSymbol.set(providerSymbol, symbol);
    rows.set(symbol, {
      symbol,
      providerSymbol,
      localSymbol: value("LOCAL_SYMBOL"),
      name: value("DESCRIPTION") || providerSymbol,
      exchange,
      type,
    });
  }
  for (const symbol of ambiguous) rows.delete(symbol);
  if (!rows.size) throw new Error("No eligible gettex instruments in dxFeed profile");
  return rows;
}

let cachedProfiles: {
  url: string;
  authorization: string;
  expiresAt: number;
  instruments: Map<string, Instrument>;
} | undefined;

async function request(config: MarketConfig, url: URL, accept: string, timeout: number) {
  const response = await fetch(url, {
    headers: { Authorization: config.authorization, Accept: accept },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error("dxFeed request failed");
  return response;
}

export async function loadProfiles(config: MarketConfig) {
  const url = config.profiles.href;
  if (cachedProfiles?.url === url && cachedProfiles.authorization === config.authorization
    && cachedProfiles.expiresAt > Date.now()) return cachedProfiles.instruments;
  const response = await request(config, config.profiles, "text/plain, text/csv, */*", 4_000);
  const instruments = parseProfiles(await response.text());
  cachedProfiles = { url, authorization: config.authorization, expiresAt: Date.now() + 15 * 60_000, instruments };
  return instruments;
}

export function findInstruments(instruments: Map<string, Instrument>, query: string) {
  const needle = query.toUpperCase();
  return [...instruments.values()].flatMap((item) => {
    const identifiers = [item.symbol, item.symbol.slice(4), item.providerSymbol.toUpperCase(), item.localSymbol.toUpperCase()];
    const name = item.name.toUpperCase();
    const score = identifiers.includes(needle) ? 4 : identifiers.some((id) => id.startsWith(needle)) ? 3
      : name.startsWith(needle) ? 2 : name.includes(needle) ? 1 : 0;
    return score ? [{ item, score }] : [];
  }).sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, "de"))
    .slice(0, 7).map(({ item }) => ({
      symbol: item.symbol, name: item.name, exchange: item.exchange, exchangeName: "gettex", type: item.type,
    }));
}

export function parseTrades(payload: unknown, instruments: Instrument[], now = Date.now()) {
  const data = payload as { status?: string; Trade?: Record<string, Trade> } | null;
  if (data?.status !== "OK") throw new Error("Invalid dxFeed trade response");
  return instruments.flatMap((instrument) => {
    const trade = data.Trade?.[instrument.providerSymbol];
    if (trade?.eventSymbol !== instrument.providerSymbol
      || typeof trade.price !== "number" || !Number.isFinite(trade.price) || trade.price <= 0
      || typeof trade.time !== "number" || !Number.isInteger(trade.time)
      || trade.time < 946684800000 || trade.time > now + 60_000) return [];
    return [{
      symbol: instrument.symbol,
      name: instrument.name,
      price: trade.price,
      priceEur: trade.price,
      currency: "EUR",
      marketTime: new Date(trade.time).toISOString(),
      venue: "gettex",
    }];
  });
}

export async function loadTrades(config: MarketConfig, symbols: string[]) {
  const profiles = await loadProfiles(config);
  const instruments = symbols.flatMap((symbol) => {
    const instrument = profiles.get(symbol);
    return instrument ? [instrument] : [];
  });
  if (!instruments.length) return [];
  const url = new URL(config.events);
  url.searchParams.set("events", "Trade");
  url.searchParams.set("symbols", instruments.map((item) => item.providerSymbol).join(","));
  url.searchParams.set("timeout", "3");
  const response = await request(config, url, "application/json", 5_000);
  return parseTrades(await response.json(), instruments);
}
