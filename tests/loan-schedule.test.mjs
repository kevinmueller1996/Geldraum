import assert from "node:assert/strict";
import test from "node:test";
import {loanSchedule, forecastLoans} from "../app/loan-schedule.ts";

test("reduces principal only by the monthly principal share and keeps the estimated total stable", () => {
  const loan = {balance:1000,payment:510,interestRate:12,balanceDate:"2028-01-31",bookingDay:31,paidBefore:200};
  assert.equal(loanSchedule(loan,"2028-02-28").currentBalance,1000);
  assert.deepEqual(loanSchedule(loan,"2028-02-29"),{currentBalance:500,remainingInterest:5,remainingMonths:1,elapsedMonths:1,total:1215});
  assert.equal(forecastLoans([loan],new Date(2028,2,31))[0].balance,500);
  assert.equal(loanSchedule(loan,"2028-03-31").currentBalance,0);
  assert.equal(loanSchedule(loan,"2030-04-01").total,1215);
  assert.equal(forecastLoans([loan],new Date(2028,0,31)).length,0);
});
test("supports zero interest, extra payments, missing anchors and insufficient payments", () => {
  const loan={balance:1000,payment:150,extraPayment:50,bookingDay:1,balanceDate:"2027-12-31"};
  assert.equal(loanSchedule(loan,"2028-01-01").currentBalance,800);
  assert.equal(loanSchedule({...loan,balanceDate:undefined},"2028-01-01").currentBalance,1000);
  assert.equal(loanSchedule({...loan,interestRate:240},"2028-01-01").total,null);
  assert.equal(loanSchedule(loan,"2028-05-01").total,1000);
});
