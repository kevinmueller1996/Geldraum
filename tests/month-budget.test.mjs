import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
const { monthBudgetCosts } = await tsImport("../app/month-budget.ts", import.meta.url);

test("the full calendar month includes due instalments, scheduled rates and paid one-offs once", () => {
  const expenses = [
    {id:"rent", amount:700, bookingDay:1, rateChanges:[{date:"2026-11-15", amount:800}]},
    {id:"phone", amount:30, bookingDay:31, rateChanges:[{date:"2026-11-25", amount:35}]},
    {id:"quarter", amount:90, frequency:"quarterly", month:1},
    {id:"annual", amount:165, frequency:"annual", month:10},
    {id:"other", amount:300, frequency:"annual", month:11},
    {id:"paid", amount:49.95, frequency:"once", dueDate:"2026-11-02", paid:true},
    {id:"old", amount:100, frequency:"once", dueDate:"2025-11-02"}
  ];
  const loans = [{id:"last", balance:42.50, payment:100, bookingDay:3, balanceDate:"2026-10-31"}];
  for (const day of [1,23,30]) {
    const {rows,total} = monthBudgetCosts(expenses, loans, new Date(2026,10,day,12));
    assert.deepEqual(rows.map(x=>x.id), ["rent","phone","quarter","annual","paid","last"]);
    assert.equal(total, 1082.45);
  }
  assert.equal(monthBudgetCosts([], loans, new Date(2026,11,1)).total,0);
});
