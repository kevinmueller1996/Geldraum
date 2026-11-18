import { searchDelayed } from "../../../market/delayed";
import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { findInstruments, hasGettexSettings, loadProfiles, marketConfig, marketUnavailable } from "../../../market/gettex";
import { isRequestAuthenticated } from "../../../password-auth";
import { needsCloudflareBackendProxy, proxyApiRequest } from "../../../vercel/proxy-api";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: NextRequest) {
  if (needsCloudflareBackendProxy()) return proxyApiRequest(request);
  if (!await isRequestAuthenticated(request)) return json({ authenticated: false }, 401);
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 64) return json({ suggestions: [] });

  try {
    if (!hasGettexSettings(env)) return json({ suggestions: await searchDelayed(query), provider: "Yahoo Finance", delayed: true });
    const instruments = await loadProfiles(marketConfig(env));
    return json({ suggestions: findInstruments(instruments, query) });
  } catch {
    return json({ suggestions: [], error: hasGettexSettings(env) ? marketUnavailable : "Wertpapiersuche gerade nicht verfügbar." }, 503);
  }
}
