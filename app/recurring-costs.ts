export const standardExpenseCategories = ["Wohnen", "Versicherungen", "Mobilität", "Kommunikation", "Lebenshaltung", "Abos & Sonstiges", "Sonstige"];

export function expenseCategoryResolver() {
  const known = [...standardExpenseCategories, "Unterhaltung", "Kreditraten"];
  const labels = new Map(known.map(name => [name.toLocaleLowerCase("de"), name]));
  return (raw: string) => {
    const label = raw.normalize("NFC").replace(/[\u00ad\u200b\u2060\ufeff]/gu, "").trim().replace(/\s+/gu, " ") || "Sonstige";
    const key = label.toLocaleLowerCase("de");
    if (key.replaceAll(" ", "") === "unterhaltung") return "Unterhaltung";
    const display = labels.get(key) ?? label;
    labels.set(key, display);
    return display;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Keep the original storage layout so older clients can read the same plan.
export function normalizePlanCategories(plan: unknown) {
  if (!isRecord(plan)) return plan;
  const category = expenseCategoryResolver();
  const result = { ...plan };
  for (const section of ["expenses", "annualCosts", "commitments"]) {
    const entries = plan[section];
    if (!Array.isArray(entries)) continue;
    result[section] = entries.map(entry => isRecord(entry) && typeof entry.category === "string"
      ? { ...entry, category: category(section === "commitments" && !entry.category.trim() ? "Kreditraten" : entry.category) }
      : entry);
  }
  if (isRecord(plan.categoryColors)) {
    const colors = new Map<string, unknown>();
    for (const [label, color] of Object.entries(plan.categoryColors)) {
      const canonical = category(label);
      if (canonical === label || !colors.has(canonical)) colors.set(canonical, color);
    }
    result.categoryColors = Object.fromEntries(colors);
  }
  return result;
}

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
  const category = expenseCategoryResolver();
  return [...expenses, ...legacy].map(item => ({ ...item, category: category(item.category) }));
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

type ForecastItem = { id: string; name: string; bookingDay?: number };
export type ForecastRow = { id: string; itemId: string; section: "income" | "expenses" | "loans"; name: string; amount: number; day: number; monthUnknown: boolean };

export function monthEndForecast(balance: number, today: Date, plan: {
  incomes: (ForecastItem & { amount: number; annual: boolean; month?: number })[];
  expenses: Expense[];
  commitments: (ForecastItem & { payment: number; extraPayment?: number })[];
}) {
  const month = today.getMonth(), day = today.getDate();
  const lastDay = new Date(today.getFullYear(), month + 1, 0).getDate();
  const scheduled: ForecastRow[] = [], uncertain: ForecastRow[] = [];
  function include(section: ForecastRow["section"], item: ForecastItem, amount: number, monthUnknown = false) {
    const due = Math.min(item.bookingDay ?? 0, lastDay);
    if (!amount || (due > 0 && due < day)) return;
    const rows = due > day && !monthUnknown ? scheduled : uncertain;
    rows.push({ id: section + ":" + item.id, itemId: item.id, section, name: item.name, amount, day: due, monthUnknown });
  }
  for (const item of plan.incomes) {
    if (!item.annual || item.month === undefined || item.month === month) {
      include("income", item, item.amount, item.annual && item.month === undefined);
    }
  }
  for (const item of plan.expenses) {
    if (isExpenseDue(item, month)) include("expenses", item, -item.amount);
  }
  for (const loan of plan.commitments) include("loans", loan, -Math.max(0, loan.payment + (loan.extraPayment ?? 0)));
  scheduled.sort((a, b) => a.day - b.day);
  const datedBalance = scheduled.reduce((sum, row) => sum + row.amount, balance);
  const low = uncertain.reduce((sum, row) => sum + Math.min(0, row.amount), datedBalance);
  const high = uncertain.reduce((sum, row) => sum + Math.max(0, row.amount), datedBalance);
  return { scheduled, uncertain, datedBalance, low, high };
}
