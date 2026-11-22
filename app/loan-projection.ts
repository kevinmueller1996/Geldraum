import { monthlyLoanPayment } from "./recurring-costs";
export { monthlyLoanPayment } from "./recurring-costs";

export function loanProjection(item: { balance: number; payment: number; interestRate?: number; extraPayment?: number; termMonths?: number }) {
  const monthlyRate = Math.max(item.interestRate ?? 0, 0) / 1200;
  const payment = Math.max(0, item.payment + (item.extraPayment ?? 0));
  const balanceAfter = (monthsAhead: number) => {
    if (!monthlyRate) return Math.max(item.balance - payment * monthsAhead, 0);
    const growth = Math.expm1(monthsAhead * Math.log1p(monthlyRate));
    return Math.max(item.balance + (item.balance * monthlyRate - payment) * growth / monthlyRate, 0);
  };
  let calculatedMonths = 0;
  if (payment > 0) {
    calculatedMonths = monthlyRate > 0
      ? payment > item.balance * monthlyRate ? Math.ceil(-Math.log1p(-(monthlyRate * item.balance) / payment) / Math.log1p(monthlyRate)) : 0
      : Math.ceil(item.balance / payment);
  }
  const monthsLeft = item.balance > 0 ? item.termMonths || calculatedMonths : 0;
  const fullPayments = Math.max(0, calculatedMonths - 1);
  const finalPayment = Math.min(payment, balanceAfter(fullPayments) * (1 + monthlyRate));
  const interestCost = item.balance === 0 ? 0 : calculatedMonths ? Math.max(payment * fullPayments + finalPayment - item.balance, 0) : null;
  return { payment: monthlyLoanPayment(item), monthsLeft, calculatedMonths, interestCost, balanceIn12Months: balanceAfter(12), balanceAtTerm: monthsLeft ? balanceAfter(monthsLeft) : item.balance };
}
