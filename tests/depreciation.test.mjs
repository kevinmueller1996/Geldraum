import test from "node:test";
import assert from "node:assert/strict";
import { depreciation } from "../app/depreciation.ts";
import { validDepreciation } from "../app/plan-validation.ts";
const asset = {kind: "other", balance: 1000, depreciationStart: "2026-12", usefulLifeMonths: 3, residualValue: 100};
test("business month-end values start in the acquisition month and stop at residual value", () => {
  for (const [month, value] of [["2026-11", 0], ["2026-12", 700], ["2027-01", 400], ["2027-02", 100], ["2030-12", 100]]) {
    assert.equal(depreciation(asset, month).book, value);
  }
  assert.equal(depreciation({...asset, residualValue:0}, "2027-01").book, 333.33);
  assert.equal(depreciation({...asset, usefulLifeMonths:1}, "2026-12").book, 100);
});
test("existing assets remain valid; inconsistent asset schedules are rejected", () => {
  assert.equal(validDepreciation({kind:"security",balance:0}), true);
  assert.equal(validDepreciation(asset), true);
  for (const change of [{usefulLifeMonths:0}, {usefulLifeMonths:1.5}, {residualValue:1001}, {residualValue:-1}, {depreciationStart:"2026-13"}, {kind:"security"}, {depreciationStart:undefined}]) {
    assert.equal(validDepreciation({...asset,...change}), false);
  }
});
