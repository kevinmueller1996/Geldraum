import { NextRequest, NextResponse } from "next/server";
import { isRequestAuthenticated } from "../../../password-auth";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../../vercel/proxy-api";

export const dynamic = "force-dynamic";

type ProviderMeta = {
  currency?: string;
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketTime?: number;
  longName?: string;
  shortName?: string;
};

type ProviderResponse = {
  chart?: { result?: Array<{ meta?: ProviderMeta }> | null; error?: unknown };
};

type RawQuote = { symbol: string; name: string; price: number; currency: string; marketTime: string };

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function isAuthenticated(request: NextRequest) {
  return isRequestAuthenticated(request);
}

function validSymbol(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9.^=_:-]{1,30}$/.test(value);
}

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
  const data = await response.json() as ProviderResponse;
  const meta = data.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (!meta || typeof price !== "number" || !Number.isFinite(price) || price < 0) throw new Error("quote unavailable");
  const currency = (meta.currency || "EUR").toUpperCase();
  return {
    symbol: (meta.symbol || symbol).toUpperCase(),
    name: meta.longName || meta.shortName || symbol,
    price,
    currency,
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1_000).toISOString() : new Date().toISOString(),
  };
}

export async function POST(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  if (!isSameOrigin(request)) return json({ error: "Unzulässige Anfrage." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "JSON erwartet." }, 415);
  if (!await isAuthenticated(request)) return json({ authenticated: false }, 401);

  try {
    const body = await request.json() as { symbols?: unknown };
    if (!Array.isArray(body.symbols) || body.symbols.length < 1 || body.symbols.length > 20) return json({ error: "Zwischen 1 und 20 Börsensymbole erwartet." }, 400);
    const symbols = [...new Set(body.symbols.map((item) => typeof item === "string" ? item.trim().toUpperCase() : item))];
    if (!symbols.every(validSymbol)) return json({ error: "Ungültiges Börsensymbol." }, 400);

    const settled = await Promise.allSettled(symbols.map(providerQuote));
    const rawQuotes = settled.flatMap((item) => item.status === "fulfilled" ? [item.value] : []);
    const failed = new Set(symbols.filter((_, index) => settled[index].status === "rejected"));
    const currencies = [...new Set(rawQuotes.map((quote) => quote.currency).filter((currency) => currency !== "EUR"))];
    const fxSettled = await Promise.allSettled(currencies.map(async (currency) => ({ currency, quote: await providerQuote(`${currency}EUR=X`) })));
    const euroRates = new Map<string, number>([["EUR", 1]]);
    fxSettled.forEach((item) => {
      if (item.status === "fulfilled") euroRates.set(item.value.currency, item.value.quote.price);
    });

    const quotes = rawQuotes.flatMap((quote) => {
      const exchangeRate = euroRates.get(quote.currency);
      if (!exchangeRate) {
        failed.add(quote.symbol);
        return [];
      }
      return [{ ...quote, priceEur: quote.price * exchangeRate }];
    });
    const errors = symbols.filter((symbol) => failed.has(symbol)).map((symbol) => ({ symbol }));
    return json({ quotes, errors, provider: "Yahoo Finance", delayed: true }, quotes.length ? 200 : 502);
  } catch {
    return json({ error: "Die Marktwerte konnten gerade nicht geladen werden." }, 503);
  }
}
