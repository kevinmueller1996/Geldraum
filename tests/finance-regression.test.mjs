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

test("positive balances, overdrafts and each card settlement reconcile with the month-end total", async () => {
  const { monthEndForecast } = await import("../app/recurring-costs.ts");
  const accounts = [
    {id:"bank",type:"bank",balance:600}, {id:"cash",type:"cash",balance:25},
    {id:"overdraft",type:"bank",balance:-50}, {id:"later",type:"credit",balance:120,bookingDay:1},
    {id:"open",type:"credit",balance:20}, {id:"card",type:"credit",balance:400,bookingDay:28}
  ].map(a => ({...a,name:a.id}));
  const forecast = monthEndForecast(35,new Date(2026,10,22),{accounts,incomes:[],commitments:[],
    expenses:[{id:"fee",name:"Kartengebühr",amount:5,bookingDay:28}]});
  const shown = forecast.rowsFromToday.map(e => e.kind === "transfer" ? -e.account.balance : e.row.amount);
  assert.deepEqual([forecast.positiveBalance, forecast.overdrafts, forecast.datedBalance],[625,-50,30]);
  assert.equal(shown.reduce((sum,amount)=>sum+amount,forecast.positiveBalance+forecast.overdrafts),forecast.datedBalance);
  assert.deepEqual(forecast.rowsFromToday.filter(e=>e.kind==="transfer" && e.reserved).map(e=>e.account.id),["later","open"]);
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

test("business expenses use the same payable cents for either input basis", async () => {
  const { grossFromNet, netFromGross, averageMonthlyCosts, monthEndForecast } = await import("../app/recurring-costs.ts");
  for (const [net, rate, gross] of [[100, 19, 119], [100, 0, 100], [-10.5, 7, -11.24], [80, 8.25, 86.60], [0.5, 19, 0.60]]) {
    assert.equal(grossFromNet(net, rate), gross);
    assert.equal(netFromGross(gross, rate), net);
  }
  const item = { id: "e", name: "Software", category: "Büro", frequency: "quarterly", month: 0,
    bookingDay: 15, amount: grossFromNet(100, 19), vatBasis: "net", vatRate: 19 };
  const plan = { name: "Test", expenses: [item], annualCosts: [], incomes: [], accounts: [], savings: [], commitments: [], goals: [], snapshots: [] };
  assert.deepEqual(backupPlan(plan), plan);
  assert.equal(averageMonthlyCosts([item], [], "2026-01-05"), 119 / 3);
  assert.equal(monthEndForecast(500, new Date(2026, 0, 5), plan).scheduled[0].amount, -119);
  for (const bad of [{vatRate: -1}, {vatRate: 100.1}, {vatRate: 0.001}, {vatRate: "19"}, {vatBasis: "x"}]) {
    assert.equal(backupPlan({...plan, expenses: [{...item, ...bad}]}), null);
  }
});

test("business income retains VAT across restoration and forecasts the gross receipt", async () => {
  const { grossFromNet, netFromGross, monthEndForecast } = await import("../app/recurring-costs.ts");
  const income = { id: "service", name: "Vertrag", annual: false, bookingDay: 25, vatBasis: "net", vatRate: 19, amount: grossFromNet(100, 19) };
  const annual = { ...income, id: "annual", annual: true, month: 10, vatBasis: "gross", vatRate: 7, amount: 107 };
  const legacy = { id: "legacy", name: "Bestand", annual: false, bookingDay: 26, amount: 80 };
  const plan = { name: "Test", expenses: [], annualCosts: [], incomes: [income, annual, legacy], accounts: [], savings: [], commitments: [], goals: [], snapshots: [] };
  const restored = backupPlan(JSON.parse(JSON.stringify(plan)));
  assert.deepEqual(restored, plan);
  assert.equal(restored.incomes.reduce((sum, row) => sum + netFromGross(row.amount, row.vatRate ?? 0), 0), 280);
  assert.equal(monthEndForecast(0, new Date(2026, 10, 1), restored).datedBalance, 306);
  for (const patch of [{ vatRate: -1 }, { vatRate: 101 }, { vatBasis: "invalid" }]) {
    assert.equal(backupPlan({ ...plan, incomes: [{ ...income, ...patch }] }), null);
  }
});

test("business monthly net totals convert each payable amount before averaging", async () => {
  const { averageMonthlyCosts, flexibleMonthlyBudget } = await import("../app/recurring-costs.ts");
  const expenses = [
    { amount: 119, vatRate: 19, rateChanges: [{ date: "2026-02-01", amount: 238 }] },
    { amount: 321, frequency: "quarterly", vatRate: 7 },
    { amount: 120, frequency: "annual" }, { amount: -11.90, vatRate: 19 },
    { amount: 119, frequency: "once", vatRate: 19 }
  ];
  const loans = [{ balance: 400, payment: 25 }];
  assert.equal(averageMonthlyCosts(expenses, loans, "2026-02-20", "net"), 325);
  assert.equal(averageMonthlyCosts(expenses, loans, "2026-02-20"), 368.1);
  assert.equal(flexibleMonthlyBudget([{ amount: 119, vatRate: 19 }, { amount: 10 }, { amount: 3, vatRate: 0 }], "net"), 113);
});

test("loan priority is optional, round-trips and uses amortized balances", async () => {
  const { currentLoan } = await import("../app/loan-schedule.ts");
  const loan = { id: "a", name: "Test", balance: 200, payment: 20, balanceDate: "2026-01-01", bookingDay: 1 };
  const plan = { name: "Test", expenses: [], annualCosts: [], incomes: [], accounts: [], savings: [], goals: [], snapshots: [],
    commitments: [loan, {...loan, id: "b", highPriority: true}, {...loan, id: "c", highPriority: false}] };
  assert.deepEqual(backupPlan(plan), plan);
  const active = plan.commitments.map(item => currentLoan(item, "2026-02-01"));
  assert.equal(active.filter(item => item.highPriority).reduce((sum, item) => sum + item.balance, 0), 180);
  assert.equal(backupPlan({...plan, commitments: [{...loan, highPriority: "true"}]}), null);
});

test("undated flexible costs use a full monthly budget and only the remaining calendar days in the forecast", async () => {
  const { monthEndForecast, flexibleMonthlyBudget } = await import("../app/recurring-costs.ts");
  const plan = { name:"Test", expenses:[], annualCosts:[], incomes:[], accounts:[], commitments:[], savings:[], goals:[], snapshots:[],
    flexibleCosts:[{id:"one", name:"Einkauf", amount:200.01}, {id:"two",name:"Freizeit", amount:89.99}] };
  assert.equal(flexibleMonthlyBudget(plan.flexibleCosts), 290);
  assert.deepEqual(backupPlan(plan), plan);
  for (const [day, remaining] of [[1,290],[15,150],[29,10]]) {
    const f = monthEndForecast(1000, new Date(2028,1,day), plan);
    assert.deepEqual([f.remainingBudget,f.datedBalance,f.projectedBalance,f.low,f.high],[remaining,1000,1000-remaining,1000-remaining,1000-remaining]);
    assert.equal(f.rowsFromToday.length + f.uncertain.length, 0);
  }
  for(const patch of [{name:" "},{amount:-1},{amount:1.001}]) assert.equal(backupPlan({...plan, flexibleCosts:[{...plan.flexibleCosts[0],...patch}]}),null);
});
