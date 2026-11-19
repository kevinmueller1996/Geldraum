import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { gettexSymbol, hasGettexSettings, loadTrades, marketConfig, marketProvider, marketUnavailable } from "../../../market/gettex";
import { isRequestAuthenticated } from "../../../password-auth";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../../vercel/proxy-api";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

function validSymbol(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9.^=_:-]{1,30}$/.test(value);
}

export async function POST(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Unzulässige Anfrage." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "JSON erwartet." }, 415);
  if (!await isRequestAuthenticated(request)) return json({ authenticated: false }, 401);

  const body = await request.json().catch(() => null) as { symbols?: unknown } | null;
  if (!Array.isArray(body?.symbols) || body.symbols.length < 1 || body.symbols.length > 20) {
    return json({ error: "Zwischen 1 und 20 Börsensymbole erwartet." }, 400);
  }
  const symbols = [...new Set(body.symbols.map((item: unknown) => typeof item === "string" ? item.trim().toUpperCase() : item))];
  if (!symbols.every(validSymbol)) return json({ error: "Ungültiges Börsensymbol." }, 400);

  try {
    const eligible = symbols.filter((symbol) => gettexSymbol.test(symbol));
    if (!hasGettexSettings(env) || !eligible.length) {
      return json({ quotes: [], errors: symbols.map(symbol => ({ symbol })), provider: null });
    }
    const quotes = await loadTrades(marketConfig(env), eligible);
    const found = new Set(quotes.map(quote => quote.symbol));
    return json({ quotes, errors: symbols.filter(symbol => !found.has(symbol)).map(symbol => ({ symbol })), provider: marketProvider });
  } catch {
    return json({ error: marketUnavailable }, 503);
  }
}
