type ProviderResult = {
  symbol?: string;
  name?: string;
  exch?: string;
  exchDisp?: string;
  type?: string;
  typeDisp?: string;
};

type ProviderResponse = { ResultSet?: { Result?: ProviderResult[] } };
type ProviderSearchResult = { symbol?: string; longname?: string; shortname?: string; exchange?: string; exchDisp?: string; quoteType?: string };
type ProviderSearchResponse = { quotes?: ProviderSearchResult[] };
type SearchCandidate = { symbol: string; name: string; exchange: string; exchangeName: string; type: "Aktie" | "ETF" | "Fonds"; sourcePriority: number; providerRank: number };

function rankSuggestion(item: SearchCandidate, query: string) {
  const symbol = item.symbol.toUpperCase();
  const name = item.name.toUpperCase();
  const exchange = item.exchange.toUpperCase();
  let score = 0;
  if (symbol === query) score += 100;
  if (symbol.startsWith(query)) score += 45;
  if (name.startsWith(query)) score += 35;
  if (name.includes(query)) score += 15;
  if (exchange === "GER") score += 120;
  else if (exchange === "FRA") score += 80;
  else if (["DUS", "BER", "MUN", "STU", "HAM", "HAN"].includes(exchange)) score += 55;
  return score;
}

function instrumentKey(item: SearchCandidate) {
  const legalSuffixes = new Set(["AG", "CO", "KG", "KGAA", "SE", "INC", "INCORPORATED", "LTD", "LIMITED", "PLC", "CORP", "CORPORATION", "NV", "SA"]);
  const tokens = item.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().split(/\s+/);
  const meaningful = tokens.filter((token) => !legalSuffixes.has(token));
  return `${item.type}:${(meaningful.length ? meaningful : tokens).join("")}`;
}

async function providerRequest<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; Njora/1.0; security-search)",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("provider unavailable");
  return await response.json() as T;
}

export async function searchDelayed(query: string) {
  const autocompleteUrl = new URL("https://query2.finance.yahoo.com/v6/finance/autocomplete");
  autocompleteUrl.searchParams.set("lang", "de-DE");
  autocompleteUrl.searchParams.set("region", "DE");
  autocompleteUrl.searchParams.set("query", query);
  const searchUrl = new URL("https://query2.finance.yahoo.com/v1/finance/search");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("quotesCount", "12");
  searchUrl.searchParams.set("newsCount", "0");
  searchUrl.searchParams.set("listsCount", "0");
  searchUrl.searchParams.set("enableFuzzyQuery", "true");
  const [autocompleteResult, searchResult] = await Promise.allSettled([
    providerRequest<ProviderResponse>(autocompleteUrl),
    providerRequest<ProviderSearchResponse>(searchUrl),
  ]);
  if (autocompleteResult.status === "rejected" && searchResult.status === "rejected") throw new Error("provider unavailable");
  const autocomplete = autocompleteResult.status === "fulfilled" ? autocompleteResult.value.ResultSet?.Result ?? [] : [];
  const searched = searchResult.status === "fulfilled" ? searchResult.value.quotes ?? [] : [];
  const candidates: SearchCandidate[] = [
    ...searched.filter((item) => item.symbol && (item.longname || item.shortname) && ["EQUITY", "ETF", "MUTUALFUND"].includes(item.quoteType || "")).map((item, index) => ({ symbol: item.symbol!, name: item.longname || item.shortname!, exchange: item.exchange || "", exchangeName: item.exchDisp || item.exchange || "Börse", type: item.quoteType === "ETF" ? "ETF" as const : item.quoteType === "MUTUALFUND" ? "Fonds" as const : "Aktie" as const, sourcePriority: 0, providerRank: index })),
    ...autocomplete.filter((item) => item.symbol && item.name && ["S", "E", "M"].includes(item.type || "")).map((item, index) => ({ symbol: item.symbol!, name: item.name!, exchange: item.exch || "", exchangeName: item.exchDisp || item.exch || "Börse", type: item.type === "E" ? "ETF" as const : item.type === "M" ? "Fonds" as const : "Aktie" as const, sourcePriority: 1, providerRank: index })),
  ].filter((item, index, items) => items.findIndex((candidate) => candidate.symbol === item.symbol) === index);
  const upperQuery = query.toUpperCase();
  const grouped = new Map<string, SearchCandidate[]>();
  candidates.forEach((item) => grouped.set(instrumentKey(item), [...(grouped.get(instrumentKey(item)) ?? []), item]));
  const suggestions = [...grouped.values()]
    .map((listings) => listings.sort((a, b) => a.sourcePriority - b.sourcePriority || a.providerRank - b.providerRank)[0])
    .sort((a, b) => rankSuggestion(b, upperQuery) - rankSuggestion(a, upperQuery))
    .slice(0, 7)
    .map((item) => ({ symbol: item.symbol, name: item.name, exchange: item.exchange, exchangeName: item.exchangeName, type: item.type }));
  return suggestions;
}

type ProviderMeta = {
  currency?: string;
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketTime?: number;
  longName?: string;
  shortName?: string;
};

type ChartResponse = {
  chart?: { result?: Array<{ meta?: ProviderMeta }> | null; error?: unknown };
};

type RawQuote = { symbol: string; name: string; price: number; currency: string; marketTime: string };

async function providerQuote(symbol: string): Promise<RawQuote> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; Njora/1.0; market-value-check)",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("provider unavailable");
  const data = await response.json() as ChartResponse;
  const meta = data.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (!meta || !meta.currency || !meta.regularMarketTime || meta.symbol?.toUpperCase() !== symbol || typeof price !== "number" || !Number.isFinite(price) || price <= 0) throw new Error("quote unavailable");
  const currency = meta.currency === "GBp" || meta.currency === "GBX" ? "GBP" : meta.currency.toUpperCase();
  return {
    symbol: (meta.symbol || symbol).toUpperCase(),
    name: meta.longName || meta.shortName || symbol,
    price: meta.currency === "GBp" || meta.currency === "GBX" ? price / 100 : price,
    currency,
    marketTime: new Date(meta.regularMarketTime * 1_000).toISOString(),
  };
}


export async function loadDelayedQuotes(symbols: string[]) {
  const settled = await Promise.allSettled(symbols.map(providerQuote));
  const rawQuotes = settled.flatMap((item) => item.status === "fulfilled" ? [item.value] : []);
  const currencies = [...new Set(rawQuotes.map((quote) => quote.currency).filter((currency) => currency !== "EUR"))];
  const fxSettled = await Promise.allSettled(currencies.map(async (currency) => ({ currency, quote: await providerQuote(`${currency}EUR=X`) })));
  const euroRates = new Map<string, number>([["EUR", 1]]);
  fxSettled.forEach((item) => {
    if (item.status === "fulfilled") euroRates.set(item.value.currency, item.value.quote.price);
  });

  const quotes = rawQuotes.flatMap((quote) => {
    const exchangeRate = euroRates.get(quote.currency);
    if (!exchangeRate) {
      return [];
    }
    return [{ ...quote, venue: "Yahoo Finance · zeitverzögert", priceEur: quote.price * exchangeRate }];
  });
  return quotes;
}
