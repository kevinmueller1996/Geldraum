import assert from "node:assert/strict";
import test from "node:test";
import { acceptsAmountEdit, parseAmount } from "../app/amount.ts";
import { loanProjection } from "../app/loan-projection.ts";
import { backupPlan } from "../app/plan-validation.ts";
import { loadDelayedQuotes } from "../app/market/delayed.ts";

test("German currency grouping agrees with the native input", () => {
  for (const [text, value] of [["40.000", 40000], ["-1.234,56", -1234.56], ["0.125", 0.125], ["7,95", 7.95], ["12.34,56", null], ["1e5", null]]) {
    assert.equal(parseAmount(text), value);
  }
});

test("amount edits allow decimal and grouping prefixes and reject mixed input atomically", () => {
  for (const amount of ["-1.234.567,89", "+40.000,50", ",5", "0.125", "000,01"]) {
    for (let end = 0; end <= amount.length; end++) assert.ok(acceptsAmountEdit(amount.slice(0, end)));
  }
  for (const input of ["12abc34", "1e5", "10 €", "12.34,56", "1,,2", "1-2", "1.234.5678", "7\n"]) {
    assert.equal(acceptsAmountEdit(input), false, input);
  }
  assert.equal(acceptsAmountEdit("-25,50", false), false);
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

test("recurring costs use monthly averages and the scheduled due months", async () => {
  const { monthlyExpense, isExpenseDue } = await import("../app/recurring-costs.ts");
  const quarterly = { amount: 300, frequency: "quarterly", month: 10 };
  const yearly = { amount: 240, frequency: "annual", month: 11 };
  const months = Array.from({ length: 12 }, (_, month) => month);
  assert.deepEqual(months.filter((month) => isExpenseDue(quarterly, month)), [1, 4, 7, 10]);
  assert.deepEqual(months.filter((month) => isExpenseDue(yearly, month)), [11]);
  assert.equal(monthlyExpense({ amount: 50 }), 50);
  assert.equal(monthlyExpense(quarterly) + monthlyExpense(yearly), 120);
});

test("dues follow calendar months and booking days, with undated entries last", async () => {
  const { byDueDate, byTargetDate } = await import("../app/recurring-costs.ts");
  const items = [
    { id: "dec", month: 11, frequency: "annual" }, { id: "free" },
    { id: "jan31", month: 0, bookingDay: 31, frequency: "annual" },
    { id: "day31", bookingDay: 31 }, { id: "day1", bookingDay: 1 },
    { id: "jan1", month: 0, bookingDay: 1, frequency: "quarterly" },
  ];
  assert.deepEqual(items.sort(byDueDate("expenses")).map((item) => item.id), ["day1", "day31", "free", "jan1", "jan31", "dec"]);
  assert.deepEqual([11, 3, 0].map((month) => ({month})).sort(byDueDate("annualCosts")).map(x => x.month), [0, 3, 11]);
  assert.deepEqual([{annual:true}, {annual:true, month:0}, {annual:false}].sort(byDueDate("incomes")).map(x=>x.month ?? x.annual), [false,0,true]);
  assert.deepEqual(["", "2027-01-01", "2026-12-31"].map(targetDate => ({targetDate})).sort(byTargetDate).map(x=>x.targetDate), ["2026-12-31", "2027-01-01", ""]);
});

test("legacy annual costs remain editable with colliding IDs and at the storage limit", async () => {
  const { unifiedExpenses, storagePlan, monthlyExpense } = await import("../app/recurring-costs.ts");
  const expenses = Array.from({ length: 250 }, (_, i) => ({ id: String(i), name: "Miete", category: " Wohnen ", amount: 10 }));
  const annualCosts = [{ id: "1", name: "Wartung", category: "wohnen", month: 3, amount: 120 }];
  const merged = unifiedExpenses(expenses, annualCosts);
  assert.equal(new Set(merged.map(x => x.id)).size, 251);
  assert.equal(merged.at(-1).category, "Wohnen");
  assert.equal(merged.reduce((sum, item) => sum + monthlyExpense(item), 0), 2510);
  const stored = storagePlan({ expenses: merged, annualCosts: [] });
  assert.equal(stored.expenses.length, 250);
  assert.deepEqual(unifiedExpenses(stored.expenses, stored.annualCosts), merged);
});
