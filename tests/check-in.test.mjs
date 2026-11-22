import test from "node:test";
import assert from "node:assert/strict";
import { checkInFields, checkInRecord } from "../app/check-in.ts";

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
