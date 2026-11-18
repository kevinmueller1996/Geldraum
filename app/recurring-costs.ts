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
