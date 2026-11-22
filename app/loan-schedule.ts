// The stored balance already includes payments on its reference date.
export type ScheduledLoan = { originalPrincipal?: number; balance: number; payment: number; extraPayment?: number; interestRate?: number; bookingDay?: number; balanceDate?: string; paidBefore?: number; termMonths?: number };

function dueIndex(date: string, bookingDay: number) {
  const [year, month, day] = date.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return year * 12 + month - (day < Math.min(bookingDay, last) ? 1 : 0);
}

export function loanSchedule(loan: ScheduledLoan, today: string) {
  const months = loan.balanceDate && loan.bookingDay && today > loan.balanceDate
    ? Math.max(0, dueIndex(today, loan.bookingDay) - dueIndex(loan.balanceDate, loan.bookingDay)) : 0;
  let balance = Math.round(Math.max(0, loan.balance) * 100);
  const rate = Math.max(0, loan.interestRate ?? 0) / 1200;
  const instalment = Math.round(Math.max(0, loan.payment + (loan.extraPayment ?? 0)) * 100);
  const interest = () => Math.round(balance * rate);
  let paid = 0;
  const amortizes = balance === 0 || instalment > interest();
  function advance() {
    const outstanding = balance + interest();
    const payment = Math.min(instalment, outstanding);
    balance = outstanding - payment;
    paid += payment;
  }
  if (amortizes) for (let i = 0; i < months && balance > 0; i++) advance();
  const currentBalance = balance / 100;
  const paidAtDate = paid;
  let remainingMonths = 0;
  if (amortizes && rate === 0 && balance > 0) { remainingMonths = Math.ceil(balance / instalment); paid += balance; balance = 0; }
  // A 100-year horizon bounds the estimate for unusual rates or terms.
  if (amortizes) for (let i = 0; i < 1200 && balance > 0; i++) { advance(); remainingMonths++; }
  const totalCents = balance === 0 ? paid + Math.round((loan.paidBefore ?? 0) * 100) : null;
  const principalCents = loan.originalPrincipal === undefined ? null : Math.round(loan.originalPrincipal * 100);
  const repaidPrincipal = principalCents === null ? null : Math.max(0, principalCents - Math.round(currentBalance * 100)) / 100;
  const knownHistory = principalCents !== null && loan.paidBefore !== undefined &&
    Math.round(loan.paidBefore * 100) >= principalCents - Math.round(loan.balance * 100);
  return {
    currentBalance, repaidPrincipal,
    lifetimeInterest: knownHistory && totalCents !== null && totalCents >= principalCents ? (totalCents - principalCents) / 100 : null,
    remainingInterest: balance === 0 ? (paid - paidAtDate) / 100 - currentBalance : null,
    remainingMonths: balance === 0 ? remainingMonths : null, elapsedMonths: months,
    total: totalCents === null ? null : totalCents / 100,
  };
}

export function currentLoan<T extends ScheduledLoan>(loan: T, day: string) {
  const state = loanSchedule(loan, day);
  return { ...loan, balance: state.currentBalance, termMonths: Math.max(0, (loan.termMonths ?? 0) - state.elapsedMonths) };
}

export function forecastLoans<T extends ScheduledLoan>(loans: T[], today: Date) {
  const year = today.getFullYear(), month = today.getMonth();
  const last = new Date(year, month + 1, 0).getDate();
  const previous = new Date(year, month, today.getDate() - 1);
  function stamp(date: Date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  }
  return loans.filter(loan => !loan.balanceDate || !loan.bookingDay ||
      loan.balanceDate < stamp(new Date(year, month, Math.min(loan.bookingDay, last))))
    .map(loan => currentLoan(loan, stamp(previous)));
}
