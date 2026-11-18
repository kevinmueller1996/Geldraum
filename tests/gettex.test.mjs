import assert from "node:assert/strict";
import { test } from "node:test";
import { findInstruments, loadTrades, marketConfig, parseProfiles, parseTrades } from "../app/market/gettex.ts";

const apple = "GTX:US0378331005";
const etf = "GTX:IE00B4L5Y983";
const profiles = [
  "#STOCK::=TYPE,SYMBOL,DESCRIPTION,CURRENCY,ISIN,OPOL,EXCHANGES,CFI,LOCAL_SYMBOL",
  'STOCK,ApC:Fixture,"Apple, ""Inc.""",EUR,US0378331005,XNAS,MUND,ES,APC',
  "STOCK,FixtureETF,Core MSCI World,EUR,IE00B4L5Y983,MUNC,,CE,IWDA",
  "STOCK,WrongCurrency,Wrong currency,USD,US30303M1027,MUNC,,ES,",
  "STOCK,WrongVenue,Wrong venue,EUR,DE0007100000,MUNA,,ES,",
  "STOCK,FirstListing,Duplicate one,EUR,DE0007164600,MUNC,,ES,",
  "STOCK,SecondListing,Duplicate two,EUR,DE0007164600,MUND,,ES,",
  "STOCK,ReusedTicker,Collision one,EUR,DE0005557508,MUND,,ES,",
  "STOCK,ReusedTicker,Collision two,EUR,DE0007236101,MUND,,ES,",
  "##COMPLETE",
].join("\r\n");
const time = Date.parse("2026-11-10T09:20:17.027Z");

test("gettex search binds names, tickers and ISINs to one verified EUR listing", () => {
  const instruments = parseProfiles(profiles);
  assert.deepEqual([...instruments.keys()], [apple, etf]);
  assert.deepEqual(findInstruments(instruments, "apc"), [{
    symbol: apple, name: 'Apple, "Inc."', exchange: "MUND", exchangeName: "gettex", type: "Aktie",
  }]);
  assert.equal(findInstruments(instruments, "IE00B4L5Y983")[0].type, "ETF");
  assert.throws(() => parseProfiles("##COMPLETE"), /No eligible gettex instruments/);
  assert.throws(() => parseProfiles(profiles.replace("##COMPLETE", "")), /Incomplete dxFeed profile snapshot/);
});

test("only matching, valid trades with an exchange timestamp become portfolio prices", () => {
  const instruments = [...parseProfiles(profiles).values()];
  const payload = { status: "OK", Trade: {
    "ApC:Fixture": { eventSymbol: "ApC:Fixture", price: 200.5, time, eventTime: 0 },
    FixtureETF: { eventSymbol: "Other", price: 100, time },
    Unexpected: { eventSymbol: "Unexpected", price: 2000, time },
  } };
  assert.deepEqual(parseTrades(payload, instruments, time), [{
    symbol: apple, name: 'Apple, "Inc."', currency: "EUR", price: 200.5, priceEur: 200.5,
    marketTime: "2026-11-10T09:20:17.027Z", venue: "gettex",
  }]);
  for (const invalid of [{ price: "NaN" }, { price: 0 }, { time: time / 1000 }, { time: time + 120_000 }]) {
    const Trade = { "ApC:Fixture": { ...payload.Trade["ApC:Fixture"], ...invalid } };
    assert.deepEqual(parseTrades({ status: "OK", Trade }, instruments, time), []);
  }
  assert.throws(() => parseTrades({ status: "ERROR" }, instruments, time), /Invalid dxFeed trade response/);
});

test("only verified provider symbols are transmitted, with authorization in the header", async (t) => {
  const env = {
    NJORA_DXFEED_GETTEX_IPF_URL: "https://fixture.dxfeed.com/ipf",
    NJORA_DXFEED_GETTEX_EVENTS_URL: "https://fixture.dxfeed.com/rest/events.json",
    NJORA_DXFEED_AUTHORIZATION: "Basic Zml4dHVyZTp0ZXN0",
  };
  assert.throws(() => marketConfig({ ...env, NJORA_DXFEED_GETTEX_EVENTS_URL: "https://dxfeed.com.example.net/trade" }));
  assert.throws(() => marketConfig({ ...env, NJORA_DXFEED_AUTHORIZATION: "" }));
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.headers.Authorization, "Basic Zml4dHVyZTp0ZXN0");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    if (url.pathname === "/ipf") return new Response(profiles);
    assert.equal(url.pathname, "/rest/events.json");
    assert.deepEqual(Object.fromEntries(url.searchParams), { events: "Trade", symbols: "ApC:Fixture", timeout: "3" });
    return Response.json({ status: "OK", Trade: { "ApC:Fixture": { eventSymbol: "ApC:Fixture", time: Date.now(), price: 200.5 } } });
  });
  const config = marketConfig(env);
  const quotes = await loadTrades(config, [apple, "AAPL", "GTX:DE0007100000"]);
  assert.deepEqual(quotes.map((quote) => quote.symbol), [apple]);
  assert.deepEqual(await loadTrades(config, ["GTX:DE0007100000"]), []);
  assert.equal(fetchMock.mock.callCount(), 2);
});
