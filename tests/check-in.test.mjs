import test from "node:test";
import assert from "node:assert/strict";
import { checkInFields, checkInRecord, previousRevenueMonth, revenueMonthLabel, revenueStats } from "../app/check-in.ts";

const today = "2026-11-21";
const plan = {
  accounts: [
    { id: "bank", name: "Giro", type: "bank", balance: 500 },
    { id: "card", name: "Karte", type: "credit", balance: 75 },
    { id: "new", name: "Neu", type: "cash", balance: 20 },
  ],
  snapshots: [
    { id: "old", date: "2026-11-01", balances: { bank: 900, card: 100, closed: 50 }, netBalance: 850, note: "November" },
  ],
};

test("editing an earlier date restores recorded values and preserves IDs, closed accounts and the old note", () => {
  const recorded = plan.snapshots[0];
  const fields = checkInFields(plan, recorded.date, today);
  assert.equal(fields.note, "November");
  assert.deepEqual(fields.accounts.map(({id, balance}) => [id, balance]), [["bank", 900], ["card", 100]]);
  assert.deepEqual(checkInRecord(plan, recorded.date, today, fields.accounts, fields.note, "unused"), recorded);
  fields.accounts[1].balance = 75.5;
  const changed = checkInRecord(plan, recorded.date, today, fields.accounts, fields.note, "unused");
  assert.equal(changed.netBalance, 874.5);
  assert.equal(changed.balances.closed, 50);
  assert.equal(plan.snapshots[0].balances.card, 100);
});

test("new dates start with editable copies of today's accounts", () => {
  const fields = checkInFields(plan, today, today);
  assert.equal(fields.note, "");
  fields.accounts[0].balance = 800;
  assert.equal(plan.accounts[0].balance, 500);
  const record = checkInRecord(plan, today, today, fields.accounts, " Stand ", "new-id");
  assert.equal(record.netBalance, 745);
  assert.equal(record.note, "Stand");
  assert.equal(record.id, "new-id");
});

test("business check-ins address a single previous calendar month, including January and leap years", () => {
  assert.equal(previousRevenueMonth("2026-01-01"), "2025-12");
  assert.equal(previousRevenueMonth("2026-01-31"), "2025-12");
  assert.equal(previousRevenueMonth("2024-03-31"), "2024-02");
  assert.equal(previousRevenueMonth(""), "");
  assert.equal(revenueMonthLabel("2025-12"), "Dezember 2025");
});

test("business history covers twelve closed months and distinguishes missing, zero and refunded net revenue", () => {
  const stats = revenueStats({"2025-12": 500, "2026-01": 200, "2026-02": 0, "2026-12": -25, "2027-01": 999}, "2027-01-31");
  assert.equal(stats.months.length, 12);
  assert.deepEqual([stats.months[0], stats.months.at(-1)], ["2026-12", "2026-01"]);
  assert.deepEqual([stats.count, stats.total, stats.min, stats.max], [3, 175, -25, 200]);
  assert.equal(revenueStats({}, "2026-03-01").count, 0);
});

test("business revenue comparisons preserve tax basis, mixed tax and cent rounding", async () => {
  const { tsImport } = await import("tsx/esm/api");
  const {revenueDraft, revenueAmounts, revenueValue, switchRevenueBasis, withRevenue} = await tsImport("../app/revenue-vat.ts", import.meta.url);
  const month = "2026-10";
  const empty = revenueDraft({}, month);
  assert.equal(empty.basis, "gross");
  for (const [amount, method, tax, net, gross] of [
    ["119", "rate", "19", 100, 119], ["1130", "tax", "130", 1000, 1130],
    ["-119", "rate", "19", -100, -119], ["-1130", "tax", "-130", -1000, -1130],
    ["0,03", "rate", "19", 0.03, 0.03], ["100", "rate", "0", 100, 100],
    ["0", "rate", "19", 0, 0]
  ]) {
    const draft = {...empty, amount, tax, method};
    const edited = switchRevenueBasis(draft, "net");
    assert.equal(edited.basis, "net");
    const plan = withRevenue({}, month, revenueAmounts(edited));
    assert.equal(revenueValue(plan, month, "net"), net);
    assert.equal(revenueValue(plan, month, "gross"), gross);
    const reopened = revenueDraft(plan, month);
    assert.deepEqual(revenueAmounts(switchRevenueBasis(reopened, "gross")), revenueAmounts(draft));
  }
  const older = {monthlyRevenue: {[month]: 100}};
  const original = revenueDraft(older, month);
  assert.equal(original.basis, "net");
  assert.equal(revenueValue(older, month, "gross"), undefined);
  assert.deepEqual(revenueAmounts(original), {net: 100});
  const corrected = withRevenue(older, month, revenueAmounts({...original, tax:"19"}));
  assert.equal(revenueValue(corrected, month, "gross"), 119);
  assert.equal(revenueValue({...corrected, monthlyRevenue: {[month]: 80}}, month, "gross"), undefined);
  assert.equal(revenueAmounts({...empty, amount: "119"}), null);
});
