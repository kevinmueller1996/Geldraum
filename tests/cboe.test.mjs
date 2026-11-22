import assert from "node:assert/strict";
import test from "node:test";
import { closingPrices, parseCloses, snapshotDay } from "../app/market/cboe.ts";
import { applyClosingPrices, closeVenue } from "../app/market/closing-prices.ts";

const isin = "DE0007164600", etf = "IE00B4L5Y983";
const descriptor = "environment=PROD,created=2026-11-18,time=10:00Z,warning=";
const heading = "company_name,isin,currency,live,asset_class,mic,bats_prev_close,reference_price";
const rows = [
  '"SAP, SE",DE0007164600,EUR,t,EQTY,XETR,194.30,999',
  "SAP,DE0007164600,EUR,t,EQTY,MTAA,191,918",
  "ETF,IE00B4L5Y983,EUR,t,ETF,XAMS,100.25,150",
  "ETF,IE00B4L5Y983,USD,t,ETF,XETR,101,151",
  "Unknown,DE0000000001,EUR,t,ETF,XETR,0,111",
  "Inactive,DE0000000002,EUR,f,EQTY,XETR,22,333",
];
const file = (lines = rows, meta = descriptor) => [meta,heading,...lines].join("\r\n");

test("selects the completed London publication day in winter, summer and on weekends", () => {
  assert.equal(snapshotDay(new Date("2026-11-16T06:59:00Z")), "2026-11-13");
  assert.equal(snapshotDay(new Date("2026-07-06T06:01:00Z")), "2026-07-06");
  assert.equal(snapshotDay(new Date("2026-11-15T13:00:00Z")), "2026-11-13");
});
test("reads only active EUR stock and ETF closes and resolves multiple listings deterministically", () => {
  for (const list of [rows, rows.toReversed()]) {
    const {prices, asOf} = parseCloses(file(list),"2026-11-18");
    assert.equal(asOf,"2026-11-18");
    assert.equal(prices.size,2); assert.equal(prices.get(isin),194.3); assert.equal(prices.get(etf),100.25);
  }
  assert.equal(parseCloses(file([...rows, rows[0].replace("194.30","999")]),"2026-11-18").prices.has(isin),false);
  for (const meta of [descriptor + "T:preliminary", descriptor.replace("PROD","CERT"), descriptor.replace("11-18","11-19")]) {
    assert.throws(() => parseCloses(file(rows,meta),"2026-11-18"));
  }
});
test("a cached feed is shared and only requested ISINs are returned", async t => {
  const today = snapshotDay(new Date());
  const mock = t.mock.method(globalThis,"fetch", async value => {
    const url = new URL(value);
    assert.equal(url.hostname,"accounteu.cboe.com");
    assert.equal(url.search,"?selectedDate=" + today);
    return new Response(file(rows,descriptor.replace("2026-11-18",today)));
  });
  const [a,b] = await Promise.all([closingPrices(new Set([isin])),closingPrices(new Set([etf]))]);
  assert.deepEqual(a.prices,{[isin]:194.3}); assert.deepEqual(b.prices,{[etf]:100.25}); assert.equal(mock.mock.callCount(),1);
});
test("prices change the selected position only, retain manual holdings and never replace a newer snapshot", () => {
  const plan = {savings:[{kind:"security",symbol:isin,quantity:2,priceEur:1},{kind:"security",symbol:"SAP.DE",priceEur:99}]};
  const snapshot = {asOf:"2026-11-18",prices:{[isin]:194.3}};
  const result = applyClosingPrices(plan,snapshot);
  assert.equal(result.savings[0].priceEur * result.savings[0].quantity,388.6);
  assert.equal(result.savings[0].quoteVenue,closeVenue); assert.equal(result.savings[0].quoteUpdatedAt,snapshot.asOf);
  assert.equal(result.savings[1],plan.savings[1]); assert.equal(applyClosingPrices(result,snapshot),result);
  assert.equal(applyClosingPrices(result,{...snapshot,asOf:"2026-11-17"}),result);
  assert.equal(applyClosingPrices(result,{asOf:"2026-11-19",prices:{}}),result);
  assert.equal(applyClosingPrices(result,null),result);
});


test("a new manual valuation survives refresh until a later daily file becomes available", () => {
  const plan = {savings:[{kind:"security", symbol:isin, priceEur:200, quoteVenue:"Manuell", quoteUpdatedAt:"2026-11-19T18:30:00.000Z"}]};
  for (const asOf of ["2026-11-18","2026-11-19"]) assert.equal(applyClosingPrices(plan,{asOf, prices:{[isin]:198}}),plan);
  assert.equal(applyClosingPrices(plan,{asOf:"2026-11-20",prices:{[isin]:201}}).savings[0].priceEur,201);
});
