import assert from "node:assert/strict";
import test from "node:test";
import { parseAmount } from "../app/amount.ts";
import { loanProjection } from "../app/loan-projection.ts";
import { backupPlan } from "../app/plan-validation.ts";
import { loadDelayedQuotes } from "../app/market/delayed.ts";

test("German currency grouping agrees with the native input", () => {
  for (const [text, value] of [["40.000", 40000], ["-1.234,56", -1234.56], ["0.125", 0.125], ["7,95", 7.95], ["12.34,56", null], ["1e5", null]]) {
    assert.equal(parseAmount(text), value);
  }
});

test("a partial final instalment and unpaid interest use the actual remaining balance", () => {
  const loan = { balance: 1000, payment: 300, interestRate: 1 };
  const forecast = loanProjection(loan);
  assert.equal(forecast.calculatedMonths, 4);
  assert.equal(forecast.interestCost.toFixed(2), "1.84");
  const unpaid = loanProjection({ ...loan, interestRate: 12, payment: 0 });
  assert.equal(unpaid.interestCost, null);
  assert.equal(unpaid.balanceIn12Months.toFixed(2), "1126.83");
  assert.equal(loanProjection({ ...loan, interestRate: 0 }).interestCost, 0);
});

test("empty or damaged backups cannot replace a plan, older complete exports still open", () => {
  const plan = { name: "Test", incomes: [], expenses: [], accounts: [], commitments: [], annualCosts: [], goals: [], snapshots: [] };
  assert.equal(backupPlan({}), null);
  assert.equal(backupPlan({ name: "Test" }), null);
  assert.deepEqual(backupPlan(plan), { ...plan, savings: [] });
  assert.equal(backupPlan({ ...plan, savings: null }), null);
  assert.equal(backupPlan({ ...plan, scenario: { cost: "kaputt" } }), null);
});

test("delayed quotes keep the trade time, and missing dates do not masquerade as fresh prices", async (t) => {
  const meta = { symbol: "SAP.DE", regularMarketPrice: 200, currency: "EUR", regularMarketTime: 1700000000 };
  t.mock.method(globalThis, "fetch", async () => Response.json({ chart: { result: [{ meta }] } }));
  const [quote] = await loadDelayedQuotes(["SAP.DE"]);
  assert.equal(quote.marketTime, new Date(1700000000000).toISOString());
  assert.match(quote.venue, /Yahoo Finance.*zeitverzögert/);
  delete meta.regularMarketTime;
  assert.deepEqual(await loadDelayedQuotes(["SAP.DE"]), []);
});
