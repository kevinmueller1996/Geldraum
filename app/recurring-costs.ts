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

export type Expense = ExpenseSchedule & { id: string; name: string; category: string; bookingDay?: number };
export type AnnualCost = Omit<Expense, "category" | "month"> & { category?: string; month: number };

export function unifiedExpenses(expenses: Expense[], annualCosts: AnnualCost[]): Expense[] {
  const used = new Set(expenses.map(item => item.id));
  const reserved = new Set(annualCosts.map(item => item.id));
  let suffix = 0;
  const legacy = annualCosts.map(item => {
    let id = item.id;
    if (used.has(id)) {
      do { id = `legacy-annual-${++suffix}`; } while (used.has(id) || reserved.has(id));
    }
    used.add(id);
    return { ...item, id, category: item.category || "Sonstige", frequency: "annual" as const };
  });
  const labels = new Map<string, string>();
  return [...expenses, ...legacy].map(item => {
    const name = item.category.trim().replace(/\s+/g, " ") || "Sonstige";
    const key = name.toLocaleLowerCase("de");
    const category = labels.get(key) ?? name;
    labels.set(key, category);
    return { ...item, category };
  });
}

// Keep large existing plans compatible with the shared storage limits.
export function storagePlan<T extends { expenses: Expense[]; annualCosts: AnnualCost[] }>(plan: T) {
  const overflow = plan.expenses.length - 250;
  if (overflow <= 0 || plan.annualCosts.length) return plan;
  const annualCosts = plan.expenses.filter((item): item is Expense & { month: number } =>
    item.frequency === "annual" && item.month !== undefined).slice(-overflow);
  const ids = new Set(annualCosts.map(item => item.id));
  return { ...plan, annualCosts, expenses: plan.expenses.filter(item => !ids.has(item.id)) };
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
