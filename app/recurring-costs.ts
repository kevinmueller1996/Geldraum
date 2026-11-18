export const frequencies = { monthly: "Monatlich", quarterly: "Quartalsweise", annual: "Jährlich" } as const;
export type Frequency = keyof typeof frequencies;

type ExpenseSchedule = { amount: number; frequency?: Frequency; month?: number };
const intervalMonths = { monthly: 1, quarterly: 3, annual: 12 };

export function monthlyExpense(item: ExpenseSchedule) {
  return item.amount / intervalMonths[item.frequency ?? "monthly"];
}

export function isExpenseDue(item: ExpenseSchedule, month: number) {
  return (month - (item.month ?? 0)) % intervalMonths[item.frequency ?? "monthly"] === 0;
}

export function cardPayment(account: { type: string; monthlyPayment?: number }) {
  return account.type === "credit" ? Math.max(0, account.monthlyPayment ?? 0) : 0;
}

type DueEntry = { month?: number; bookingDay?: number; annual?: boolean; frequency?: Frequency };

export function byDueDate(section: "expenses" | "annualCosts" | "incomes") {
  function monthOf(item: DueEntry) {
    const monthly = (section === "expenses" && (item.frequency ?? "monthly") === "monthly")
      || (section === "incomes" && !item.annual);
    return monthly ? -1 : (item.month ?? 12);
  }
  return (a: DueEntry, b: DueEntry) => monthOf(a) - monthOf(b) || (a.bookingDay || 32) - (b.bookingDay || 32);
}

export function byTargetDate(a: { targetDate?: string }, b: { targetDate?: string }) {
  const first = a.targetDate ?? "", second = b.targetDate ?? "";
  if (!first || !second) return Number(!first) - Number(!second);
  return first.localeCompare(second);
}
