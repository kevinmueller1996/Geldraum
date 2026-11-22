import assert from "node:assert/strict";
import test from "node:test";
import { acceptsAmountEdit, parseAmount } from "../app/amount.ts";
import { tsImport } from "tsx/esm/api";
const { loanProjection } = await tsImport("../app/loan-projection.ts", import.meta.url);
import { backupPlan } from "../app/plan-validation.ts";

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

test("the account response and expense picker agree on one Unterhaltung label without losing either cost", async () => {
  const { normalizePlanCategories, unifiedExpenses, monthlyExpense } = await import("../app/recurring-costs.ts");
  const expenses = [
    { id: "music", amount: 11, category: "Unterhal\u00adtung" },
    { id: "cloud", amount: 10, category: "  UNTERHALTUNG\u200b " },
    { id: "movie", amount: 12, category: "Unter\u00a0haltung", frequency: "annual", month: 2 },
    { id: "event", amount: 30, category: "Unterhaltung live" },
  ];
  const raw = { expenses, annualCosts: [], categoryColors: { "Unterhaltung ": "blue", Unterhaltung: "red" }, revisionHint: 7 };
  const clean = normalizePlanCategories(raw);
  assert.deepEqual([...new Set(clean.expenses.map(item => item.category))], ["Unterhaltung", "Unterhaltung live"]);
  assert.deepEqual(unifiedExpenses(expenses, []), clean.expenses);
  assert.equal(clean.expenses.slice(0, 3).reduce((sum, item) => sum + monthlyExpense(item), 0), 22);
  assert.deepEqual(clean.expenses.map(item => item.id), expenses.map(item => item.id));
  assert.deepEqual(clean.categoryColors, { Unterhaltung: "red" });
  assert.equal(clean.revisionHint, 7);
  assert.deepEqual(normalizePlanCategories(clean), clean);
  assert.equal(normalizePlanCategories(null), null);
});

test("loan categories survive backup and sync and use the same spelling as expenses", async () => {
  const { normalizePlanCategories } = await import("../app/recurring-costs.ts");
  const base = { name: "Kategorietest", incomes: [], accounts: [], annualCosts: [], snapshots: [], goals: [],
    expenses: [{ id: "fuel", name: "Kraftstoff", category: "Mobilität", amount: 80 }],
    commitments: [{ id: "car", name: "Auto", payment: 180, balance: 6000 }] };
  assert.ok(backupPlan(base));
  const assigned = { ...base, commitments: [{ ...base.commitments[0], category: " mobilität " }] };
  assert.ok(backupPlan(assigned));
  const result = normalizePlanCategories(assigned);
  assert.deepEqual(result.commitments[0], { ...base.commitments[0], category: "Mobilität" });
  assert.equal(backupPlan({ ...base, commitments: [{ ...base.commitments[0], category: 42 }] }), null);
});

test("month-end applies dated flows in full and keeps undated or unconfirmed flows separate", async () => {
  const { monthEndForecast } = await import("../app/recurring-costs.ts");
  const due = { id:"rent", name:"Miete", amount:100, category:"Wohnen", bookingDay:31 };
  const loan = { id:"loan", name:"Kredit", payment:70, extraPayment:10, bookingDay:19 };
  const salary = { id:"salary", name:"Gehalt", amount:2727, annual:false, bookingDay:1 };
  const plan = { incomes:[salary], expenses:[due, { ...due, id:"annual", frequency:"annual", month:11 }], commitments:[loan] };
  const date = new Date(2026,10,18);
  const project = (incomes, commitments = [loan]) => monthEndForecast(-373, date, { ...plan, incomes, commitments });
  assert.equal(project([salary]).datedBalance, -553);
  assert.equal(project([{ ...salary, bookingDay:25 }]).datedBalance, 2174);
  const ambiguous = project([{ ...salary, bookingDay:0 }], [{ ...loan, bookingDay:18 }]);
  assert.deepEqual([ambiguous.low, ambiguous.high], [-553,2254]);
  assert.equal(ambiguous.uncertain.length,2);
  assert.equal(project([salary]).scheduled.at(-1).day,30);
  const february = monthEndForecast(-373, new Date(2028,1,28), { incomes:[], expenses:[due], commitments:[] });
  assert.equal(february.scheduled[0].day,29);
});

test("forecast rows identify the original record even with matching names and IDs across lists", async () => {
  const { monthEndForecast } = await import("../app/recurring-costs.ts");
  const item = { id: "id:1", name: "Privat" };
  const result = monthEndForecast(0, new Date(2026, 10, 18), {
    incomes: [{ ...item, amount: 400, annual: true, month: 10, bookingDay: 24 }],
    expenses: [{ ...item, amount: 25, category: "Wohnen", frequency: "annual", month: 10 }],
    commitments: [{ ...item, payment: 120 }]
  });
  const rows = [...result.scheduled, ...result.uncertain];
  assert.deepEqual(rows.map(row => [row.section, row.itemId]), [
    ["income", item.id], ["expenses", item.id], ["loans", item.id]
  ]);
  assert.equal(new Set(rows.map(row => row.id)).size, 3);
});

test("loan booking days survive backups and exclude invalid calendar days", () => {
  const base = { name:"Plan", incomes:[], accounts:[], annualCosts:[], expenses:[], goals:[], snapshots:[] };
  function check(day) {
    return backupPlan({ ...base, commitments:[{ id:"l", name:"Kredit", balance:300, payment:20, bookingDay:day }] });
  }
  for (const day of [undefined,0,1,31]) assert.ok(check(day));
  for (const day of [-1,32,2.5,"10"]) assert.equal(check(day),null);
});

test("insurance aliases merge across costs, loans and colors, preserving every payment", async () => {
  const { normalizePlanCategories } = await import("../app/recurring-costs.ts");
  const plan = {
    expenses: [{ id: "m", category: "Versicherung", amount: 25 }, { id: "q", category: "Versicherungen", amount: 60, frequency: "quarterly" }],
    annualCosts: [{ id: "a", category: " VERSICHERUNG ", amount: 120 }],
    commitments: [{ id: "l", category: "versicherung", payment: 100 }],
    categoryColors: { Versicherung: "a", Versicherungen: "b" }
  };
  const clean = normalizePlanCategories(plan);
  for (const section of ["expenses", "annualCosts", "commitments"]) {
    assert.deepEqual(clean[section], plan[section].map(entry => ({ ...entry, category: "Versicherungen" })));
  }
  assert.deepEqual(clean.categoryColors, { Versicherungen: "b" });
  assert.deepEqual(normalizePlanCategories(clean), clean);
});

test("monthly credit card settlement dates use the local calendar without changing the net forecast", async () => {
  const { upcomingCardSettlements, monthEndForecast } = await import("../app/recurring-costs.ts");
  const account = { id: "card", name: "Karte", type: "credit", balance: 220, bookingDay: 31 };
  const plan = { accounts: [account], incomes: [], expenses: [], annualCosts: [], commitments: [], name: "Plan", goals: [], snapshots: [] };
  const feb = new Date(2028, 1, 29, 20);
  const [settlement] = upcomingCardSettlements(plan.accounts, feb);
  assert.equal(settlement.date.getTime(), new Date(2028, 1, 29).getTime());
  const january = upcomingCardSettlements([{ ...account, bookingDay: 12 }], new Date(2026, 11, 18));
  assert.equal(january[0].date.getTime(), new Date(2027, 0, 12).getTime());
  assert.equal(upcomingCardSettlements([{ ...account, bookingDay: undefined }], feb)[0].date, null);
  assert.deepEqual(upcomingCardSettlements([{ ...account, type: "bank" }, { ...account, balance: 0 }], feb), []);
  const forecast = monthEndForecast(1000 - account.balance, feb, plan);
  assert.deepEqual([forecast.low, forecast.datedBalance, forecast.high], [780, 780, 780]);
  assert.equal(backupPlan(plan).accounts[0].bookingDay, 31);
  for (const invalid of [-1, 32, 2.5, "12"]) {
    assert.equal(backupPlan({ ...plan, accounts: [{ ...account, bookingDay: invalid }] }), null);
  }
});

test("the forecast timeline interleaves card transfers, including today, with dated payments", async () => {
  const { monthEndForecast } = await import("../app/recurring-costs.ts");
  const card = { id: "later", name: "Karte", type: "credit", balance: 180, bookingDay: 23 };
  const plan = {
    accounts: [card, { ...card, id: "today", bookingDay: 18 }, { ...card, id: "next", bookingDay: 1 }, { ...card, id: "unknown", bookingDay: 0 }],
    incomes: [{ id: "salary", name: "Gehalt", amount: 2000, annual: false, bookingDay: 25 }],
    expenses: [{ id: "rent", name: "Miete", amount: 400, category: "Wohnen", bookingDay: 20 }],
    commitments: []
  };
  const result = monthEndForecast(-373, new Date(2026, 11, 18), plan);
  assert.deepEqual(result.rowsFromToday.map(entry => entry.kind === "transfer" ? entry.account.id : entry.row.itemId),
    ["today", "rent", "later", "salary", "next", "unknown"]);
  assert.equal(result.rowsFromToday[4].date.getTime(), new Date(2027, 0, 1).getTime());
  assert.equal(result.rowsFromToday[5].date, null);
  assert.deepEqual([result.low, result.datedBalance, result.high], [1227, 1227, 1227]);
});


test("the budget and forecast stop at the outstanding balance plus the final month's interest", async () => {
  const { monthlyLoanPayment, monthEndForecast } = await import("../app/recurring-costs.ts");
  const loan = {id: "l", name: "Schlussrate", balance: 50, payment: 180, extraPayment: 20, interestRate: 12, bookingDay: 14};
  for (const [balance, expected] of [[0, 0], [50, 50.50], [500, 200]]) {
    const entry = {...loan, balance};
    assert.equal(monthlyLoanPayment(entry), expected);
    assert.equal(loanProjection(entry).payment, expected);
    const forecast = monthEndForecast(350, new Date(2026, 10, 1), {incomes: [], expenses: [], commitments: [entry]});
    assert.equal(forecast.datedBalance, 350 - expected);
  }
});

test("a zero euro one-off invoice adds no forecast rows before, on or after its due date", async () => {
  const { monthEndForecast } = await import("../app/recurring-costs.ts");
  const expenses = [{id:"empty",name:"Offene Rechnung",frequency:"once",amount:0,dueDate:"2028-02-29",category:"Sonstige"}];
  for (const today of [new Date(2028,1,28),new Date(2028,1,29),new Date(2028,2,1)]) {
    const forecast = monthEndForecast(35,today,{incomes:[],expenses,commitments:[]});
    assert.deepEqual([forecast.datedBalance,forecast.uncertain.length,forecast.rowsFromToday.length],[35,0,0]);
  }
});
