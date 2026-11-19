import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { readFinance, prepareChanges, applyChanges } = await tsImport("../app/chatgpt/finance.ts", import.meta.url);
const day = text => new Date(text + "T12:00:00Z");
const plan = { name: "Beispiel", expenses: [{id:"electricity", name:"Strom", amount: 50, category:"Wohnen", bookingDay:25}],
  accounts:[{id:"bank", name:"Giro", balance: 1600, type:"bank"}, {id:"card", name:"Karte", balance: 100, type:"credit", bookingDay:27}],
  incomes:[{id:"salary", name:"Gehalt", annual:false, amount:2000, bookingDay:1}],
  annualCosts:[], goals:[], savings:[], snapshots:[], commitments:[] };
const invoice = {type:"invoice", name:"Verbrauch 2025", amount:84, dueDate:"2026-12-15"};
const rate = {type:"rate", name:"Strom", amount:65, effectiveDate:"2027-01-15"};
const now = day("2026-11-18");

test("one-off bill and future rate remain independent; dates and exact EUR match app forecasts", () => {
  const {actions, preview} = prepareChanges(plan,[invoice,rate],now);
  assert.equal(preview.length,2);
  assert.match(preview[1], /50,00.*65,00/);
  assert.equal(plan.expenses.length,1);
  const changed = applyChanges(plan, actions, now);
  const nov = readFinance(changed,"due",{},now);
  assert.equal(nov.averageMonthlyFixedCosts,50);
  assert.equal(nov.datedMonthEndBalance,1450);
  assert.equal(nov.upcoming.find(row=>row.type==="transfer").netEffect,0);
  const december = readFinance(changed,"due",{},day("2026-12-10"));
  assert.equal(december.datedMonthEndBalance,1366);
  const onDate = readFinance(changed,"due",{},day(invoice.dueDate));
  assert.equal(onDate.uncertain.find(row=>row.name===invoice.name).date,invoice.dueDate);
  const january = readFinance(changed,"due",{},day("2027-01-10"));
  assert.equal(january.upcoming.find(row=>row.name==="Strom").amount,-65);
  assert.equal(january.uncertain.find(row=>row.name===invoice.name).date,invoice.dueDate);
  assert.equal(readFinance(changed,"month",{},day("2027-01-20")).averageMonthlyFixedCosts,65);
  changed.expenses[1].paid = true;
  const nextDecember = readFinance(changed,"due",{},day("2027-12-01"));
  assert.ok(![...nextDecember.upcoming,...nextDecember.uncertain].some(row=>row.name===invoice.name));
});

test("rejects duplicate invoices, invalid dates and amounts, ambiguous matches and out-of-scope fields", () => {
  assert.throws(()=>prepareChanges(plan,[invoice,invoice],now),/identische Rechnung/);
  const next = applyChanges(plan,[invoice],now);
  assert.throws(()=>prepareChanges(next,[invoice],now),/identische Rechnung/);
  for (const invalid of [{...invoice,dueDate:"2026-02-30"},{...rate,amount:1.555},{...rate,amount:Infinity},
    {...rate,effectiveDate:"2025-12-15"},{...invoice,recipient:"private@example.test"},{...invoice,amount:-10}]) {
    assert.throws(()=>prepareChanges(plan,[invalid],now));
  }
  const ambiguous = {...plan,expenses:[...plan.expenses,{...plan.expenses[0],id:"other",name:"STROM"}]};
  assert.throws(()=>prepareChanges(ambiguous,[rate],now),/mehrdeutig/);
});

test("check-in records signed credit balance, preserves other balances and existing same-day note; no accidental cross-date change", () => {
  const withNote = {...plan,snapshots:[{id:"original",date:"2026-11-19",balances:{card:100,bank:1600},netBalance:1500,note:"Schon geprüft"}]};
  const changed = applyChanges(withNote,[{type:"checkin",name:"Karte",balance:-130}],new Date("2026-11-18T23:10:00Z"));
  assert.equal(changed.accounts[1].balance,130);
  assert.equal(changed.snapshots.length,1);
  assert.deepEqual(changed.snapshots[0],{id:"original",date:"2026-11-19",balances:{bank:1600,card:130},netBalance:1470,note:"Schon geprüft"});
  assert.equal(changed.accounts[0].balance,1600);
  assert.throws(()=>applyChanges(plan,[{type:"checkin",name:"Karte",balance:130}],now));
});
test("monthly simulation does not mutate the plan or include private free text", () => {
  const clone = structuredClone(plan);
  assert.deepEqual(readFinance(plan,"scenario",{monthlyDelta:150},now),{date:"2026-11-18",currency:"EUR",monthlyAvailable:1950,additionalMonthlyExpense:150,simulatedMonthlyAvailable:1800});
  assert.deepEqual(plan,clone);
  assert.ok(!JSON.stringify(readFinance(plan,"month",{},now)).includes("Giro"));
});
