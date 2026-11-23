export const standardExpenseCategories = ["Wohnen", "Versicherungen", "Mobilität", "Kommunikation", "Lebenshaltung", "Abos & Sonstiges", "Sonstige"];

export function expenseCategoryResolver() {
  const known = [...standardExpenseCategories, "Unterhaltung", "Kreditraten"];
  const labels = new Map(known.map(name => [name.toLocaleLowerCase("de"), name]));
  return (raw: string) => {
    const label = raw.normalize("NFC").replace(/[\u00ad\u200b\u2060\ufeff]/gu, "").trim().replace(/\s+/gu, " ") || "Sonstige";
    const key = label.toLocaleLowerCase("de");
    if (key === "versicherung") return "Versicherungen";
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

export const frequencies = { monthly: "Monatlich", quarterly: "Quartalsweise", annual: "Jährlich", once: "Einmalig" } as const;
export type Frequency = keyof typeof frequencies;

export type RateChange = { date: string; amount: number };
// Stored amounts, including scheduled rate changes, are always gross cash amounts.
export type VatBasis = "gross" | "net";
function vatConversion(value: number, rate: number, toGross: boolean) {
  const cents = Math.round(Math.abs(value) * 100 + Number.EPSILON * Math.abs(value) * 100);
  const factor = 10000 + Math.round(rate * 100);
  return Math.sign(value) * Math.round(toGross ? cents * factor / 10000 : cents * 10000 / factor) / 100;
}
export const grossFromNet = (net: number, rate: number) => vatConversion(net, rate, true);
export const netFromGross = (gross: number, rate: number) => vatConversion(gross, rate, false);

type ExpenseSchedule = {
  vatBasis?: VatBasis; vatRate?: number;
  amount: number; frequency?: Frequency; month?: number; dueDate?: string; paid?: boolean; rateChanges?: RateChange[];
};
const intervalMonths = { monthly: 1, quarterly: 3, annual: 12 };

export function localISO(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function expenseAmount(item: ExpenseSchedule, day?: string) {
  if (!item.rateChanges?.length) return item.amount;
  const date = day ?? localISO(new Date());
  let amount = item.amount, latest = "";
  for (const rate of item.rateChanges) {
    if (rate.date <= date && rate.date > latest) { amount = rate.amount; latest = rate.date; }
  }
  return amount;
}

export function monthlyExpense(item: ExpenseSchedule, day?: string) {
  if (item.frequency === "once") return 0;
  return expenseAmount(item, day) / intervalMonths[item.frequency ?? "monthly"];
}

export function isExpenseDue(item: ExpenseSchedule, month: number, year = new Date().getFullYear()) {
  if (item.frequency === "once") return !item.paid && item.dueDate?.slice(0, 7) === localISO(new Date(year, month, 1)).slice(0, 7);
  return (month - (item.month ?? 0)) % intervalMonths[item.frequency ?? "monthly"] === 0;
}

export type Expense = ExpenseSchedule & { id: string; name: string; category: string; bookingDay?: number };
export type FlexibleCost = Pick<Expense, "id" | "name" | "amount" | "vatRate" | "vatBasis">;

export function flexibleMonthlyBudget(items: FlexibleCost[] = []) {
  return items.reduce((cents, item) => cents + Math.round(item.amount * 100), 0) / 100;
}

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
    return { ...item, id, category: typeof item.category === "string" ? item.category : "Sonstige", frequency: "annual" as const };
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

type DueEntry = { dueDate?: string; month?: number; bookingDay?: number; annual?: boolean; frequency?: Frequency };

export function byDueDate(section: "expenses" | "annualCosts" | "incomes") {
  function monthOf(item: DueEntry) {
    const monthly = (section === "expenses" && (item.frequency ?? "monthly") === "monthly")
      || (section === "incomes" && !item.annual);
    return monthly ? -1 : (item.month ?? 12);
  }
  return (a: DueEntry, b: DueEntry) => {
    if (a.frequency === "once" && b.frequency === "once") return (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
    return monthOf(a) - monthOf(b) || (a.bookingDay || 32) - (b.bookingDay || 32);
  };
}

export function byTargetDate(a: { targetDate?: string }, b: { targetDate?: string }) {
  const first = a.targetDate ?? "", second = b.targetDate ?? "";
  if (!first || !second) return Number(!first) - Number(!second);
  return first.localeCompare(second);
}

type ForecastItem = { id: string; name: string; bookingDay?: number };
export type ForecastRow = { id: string; itemId: string; section: "income" | "expenses" | "loans"; name: string; amount: number; day: number; monthUnknown: boolean; dueDate?: string };

type CardAccount = { id: string; name: string; type: string; balance: number; bookingDay?: number };

export function upcomingCardSettlements(accounts: CardAccount[], today: Date) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  function nextDate(day: number | undefined) {
    if (!day || !Number.isInteger(day) || day < 1 || day > 31) return null;
    for (const offset of [0, 1]) {
      const month = today.getMonth() + offset;
      const last = new Date(today.getFullYear(), month + 1, 0).getDate();
      const date = new Date(today.getFullYear(), month, Math.min(day, last));
      if (date >= start) return date;
    }
    return null;
  }
  return accounts.filter(account => account.type === "credit" && account.balance > 0)
    .map(account => ({ account, date: nextDate(account.bookingDay) }))
    .sort((a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity) || a.account.name.localeCompare(b.account.name, "de"));
}

type LoanPayment = { payment: number; extraPayment?: number; balance?: number; interestRate?: number };

export function monthlyLoanPayment(loan: LoanPayment) {
  const instalment = Math.max(0, loan.payment + (loan.extraPayment ?? 0));
  if (loan.balance === undefined) return instalment;
  const outstanding = Math.max(0, loan.balance) * (1 + Math.max(0, loan.interestRate ?? 0) / 1200);
  return Math.min(instalment, Math.round(outstanding * 100) / 100);
}

// Sum the actual payments as annual cents before dividing. Adding rounded or
// fractional monthly averages makes half-cent results depend on list order.
export function averageMonthlyCosts(expenses: ExpenseSchedule[], loans: LoanPayment[], day: string) {
  function cents(amount: number) {
    const value = amount * 100, nearest = Math.round(value);
    return Math.abs(value - nearest) <= Math.abs(value) * Number.EPSILON * 4 ? nearest : value;
  }
  let yearly = loans.reduce((sum, loan) => sum + 12 * cents(monthlyLoanPayment(loan)), 0);
  for (const item of expenses) {
    if (item.frequency !== "once") {
      yearly += cents(expenseAmount(item, day)) * (12 / intervalMonths[item.frequency ?? "monthly"]);
    }
  }
  return yearly / 1200;
}

export function monthEndForecast(balance: number, today: Date, plan: {
  accounts?: CardAccount[];
  flexibleCosts?: FlexibleCost[];
  incomes: (ForecastItem & { amount: number; annual: boolean; month?: number })[];
  expenses: Expense[];
  commitments: (ForecastItem & LoanPayment)[];
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
    if (item.frequency === "once") {
      if (!item.dueDate || item.paid || item.amount === 0) continue;
      if (item.dueDate <= localISO(today)) {
        uncertain.push({ id: "expenses:" + item.id, itemId: item.id, section: "expenses", name: item.name,
          amount: -item.amount, day: Number(item.dueDate.slice(-2)), monthUnknown: false, dueDate: item.dueDate });
      } else if (isExpenseDue(item, month, today.getFullYear())) {
        include("expenses", { ...item, bookingDay: Number(item.dueDate.slice(-2)) }, -item.amount);
      }
    } else if (isExpenseDue(item, month, today.getFullYear())) {
      const due = item.bookingDay ? Math.min(item.bookingDay, lastDay) : day;
      include("expenses", item, -expenseAmount(item, localISO(new Date(today.getFullYear(), month, due))));
    }
  }
  for (const loan of plan.commitments) include("loans", loan, -monthlyLoanPayment(loan));
  scheduled.sort((a, b) => a.day - b.day);
  const datedBalance = scheduled.reduce((sum, row) => sum + row.amount, balance);
  const monthlyBudget = flexibleMonthlyBudget(plan.flexibleCosts);
  const remainingBudget = Math.round(Math.round(monthlyBudget * 100) * (lastDay - day + 1) / lastDay) / 100;
  const projectedBalance = datedBalance - remainingBudget;
  const low = uncertain.reduce((sum, row) => sum + Math.min(0, row.amount), projectedBalance);
  const high = uncertain.reduce((sum, row) => sum + Math.max(0, row.amount), projectedBalance);
  const accounts = plan.accounts ?? [];
  const positiveBalance = accounts.reduce((sum, a) => sum + Math.max(0, a.type === "credit" ? -a.balance : a.balance), 0);
  const overdrafts = accounts.reduce((sum, a) => sum + (a.type === "credit" ? 0 : Math.min(0, a.balance)), 0);
  const transfers = upcomingCardSettlements(accounts, today).map(({ account, date }) => ({
    kind: "transfer" as const, account, date, reserved: !date || date.getMonth() !== month
  }));
  const payments = scheduled.map(row => ({
    kind: "payment" as const, row, date: new Date(today.getFullYear(), month, row.day)
  }));
  const rowsFromToday = [...payments, ...transfers].sort((a, b) =>
    (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity)
  );
  return { positiveBalance, overdrafts, hasCardReserve: transfers.some(t => t.reserved), scheduled, rowsFromToday, uncertain, datedBalance, remainingBudget, projectedBalance, low, high };
}
