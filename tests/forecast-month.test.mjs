import assert from "node:assert/strict";
import test from "node:test";
import {confirmedForMonth, planningMonths} from "../app/forecast-month.ts";

test("confirmed monthly income uses the recorded VAT basis, month and year", () => {
  const entries = {
    a: {month: "2027-01", vat: {gross: 119.01, net: 100.01}},
    b: {month: "2027-01", vat: {gross: 10.70, net: 10}},
    c: {month: "2026-01", vat: {gross: 35, net: 35}},
  };
  assert.equal(confirmedForMonth(entries, "2027-01", "net"), 110.01);
  assert.equal(confirmedForMonth(entries, "2027-01", "gross"), 129.71);
  assert.equal(confirmedForMonth(entries, "2027-02", "net"), 0);
  assert.equal(confirmedForMonth(undefined, "2027-01", "net"), 0);
  entries.a.month = "2027-02";
  assert.equal(confirmedForMonth(entries, "2027-01", "net"), 10);
  assert.equal(confirmedForMonth(entries, "2027-02", "net"), 100.01);
});

test("months with commitments are selectable even outside the next twelve months", () => {
  const options = planningMonths({a: {month: "2026-10"}, b: {month: "2028-01"}, c: {month: "2027-01"}}, "2026-12");
  assert.equal(options.length, 14);
  assert.deepEqual(options.slice(0, 3), ["2026-10", "2026-12", "2027-01"]);
  assert.equal(options.at(-1), "2028-01");
});
