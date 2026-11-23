import { currentLoan } from "./loan-schedule";
import type { Plan } from "./page";
import { expenseAmount, isExpenseDue, localISO, monthlyLoanPayment } from "./recurring-costs";

type MonthCost = {section: "expenses" | "loans"; id: string; name: string; amount: number};

export function monthBudgetCosts(expenses: Plan["expenses"], loans: Plan["commitments"], today: Date) {
  const year = today.getFullYear(), month = today.getMonth();
  const last = new Date(year, month + 1, 0).getDate();
  const monthKey = localISO(today).slice(0, 7);
  const rows: MonthCost[] = [];
  for (const expense of expenses) {
    let amount: number;
    if (expense.frequency === "once") {
      // A payment changes what is outstanding, not the cost of the full month.
      if (expense.dueDate?.slice(0, 7) !== monthKey) continue;
      amount = expense.amount;
    } else {
      if (!isExpenseDue(expense, month, year)) continue;
      const day = Math.min(expense.bookingDay || today.getDate(), last);
      amount = expenseAmount(expense, localISO(new Date(year, month, day)));
    }
    if (amount) rows.push({section: "expenses", id: expense.id, name: expense.name, amount});
  }
  for (const loan of loans) {
    const day = Math.min(loan.bookingDay || today.getDate(), last);
    const beforePayment = localISO(new Date(year, month, day - 1));
    const amount = monthlyLoanPayment(currentLoan(loan, beforePayment));
    if (amount) rows.push({section: "loans", id: loan.id, name: loan.name, amount});
  }
  return {rows, total: rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100};
}
