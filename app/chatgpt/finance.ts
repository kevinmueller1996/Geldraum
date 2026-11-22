import { currentLoan, forecastLoans } from "../loan-schedule";
import type { Plan } from "../page";
import { isPlan, validCalendarDay } from "../plan-validation";
import { averageMonthlyCosts, expenseAmount, localISO, monthEndForecast, unifiedExpenses } from "../recurring-costs";

type Invoice = { type: "invoice"; name: string; amount: number; dueDate: string; category?: string };
type Rate = { type: "rate"; name: string; amount: number; effectiveDate: string };
type CheckIn = { type: "checkin"; name: string; balance: number };
export type FinanceAction = Invoice | Rate | CheckIn;

const euro = new Intl.NumberFormat("de-DE", {style: "currency", currency: "EUR"});

function berlinDate(now: Date) {
  const day = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Berlin"
  }).format(now);
  return new Date(day + "T12:00:00");
}

function planData(value: unknown) {
  if (!isPlan(value)) throw new Error("Kein vollständiger Finanzplan verfügbar.");
  return value as unknown as Plan;
}

const cents = new Intl.NumberFormat("en-US", {useGrouping: false, maximumFractionDigits: 2});
function rounded(value: number) { return Number(cents.format(value)); }

function netBalance(plan: Plan) {
  return plan.accounts.reduce((total, a) => total + (a.type === "credit" ? -a.balance : a.balance), 0);
}

function money(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e9 || rounded(value) !== value) {
    throw new Error("Bitte einen gültigen Eurobetrag mit höchstens zwei Nachkommastellen angeben.");
  }
  return value;
}

export function readFinance(value: unknown, query: "month" | "due" | "scenario", args: {monthlyDelta?: number} = {}, now = new Date()) {
  const plan = planData(value);
  const today = berlinDate(now);
  const date = localISO(today);
  const expenses = unifiedExpenses(plan.expenses, plan.annualCosts);
  const currentIncome = plan.incomes.filter(i => !i.annual).reduce((total, i) => total + i.amount, 0);
  const costs = averageMonthlyCosts(expenses, plan.commitments.map(loan => currentLoan(loan, date)), date);
  const available = currentIncome - costs;
  if (query === "scenario") {
    const extra = money(args.monthlyDelta);
    return {date, currency: "EUR", monthlyAvailable: rounded(available), additionalMonthlyExpense: extra,
      simulatedMonthlyAvailable: rounded(available - extra)};
  }
  const balance = netBalance(plan);
  const forecast = monthEndForecast(balance, today, {...plan, expenses, commitments: forecastLoans(plan.commitments, today)});
  const summary = {date, currency: "EUR", balance: rounded(balance), lastCheckIn: plan.snapshots.map(s => s.date).sort().at(-1) ?? null,
    regularMonthlyIncome: rounded(currentIncome), averageMonthlyFixedCosts: rounded(costs), monthlyAvailable: rounded(available),
    datedMonthEndBalance: rounded(forecast.datedBalance), monthEndLow: rounded(forecast.low), monthEndHigh: rounded(forecast.high)};
  if (query === "month") return summary;
  if (query !== "due") throw new Error("Unbekannte Auswertung.");
  return {...summary, upcoming: forecast.rowsFromToday.filter(row => !row.date || row.date.getMonth() === today.getMonth())
    .map(entry => entry.kind === "payment" ? {name: entry.row.name, amount: rounded(entry.row.amount), date: localISO(entry.date), type: "payment"}
      : {name: entry.account.name, amount: rounded(-entry.account.balance), date: entry.date ? localISO(entry.date) : null, type: "transfer", netEffect: 0}),
    uncertain: forecast.uncertain.map(row => ({name: row.name, amount: rounded(row.amount),
      date: row.dueDate ?? (row.day && !row.monthUnknown ? localISO(new Date(today.getFullYear(), today.getMonth(), row.day)) : null)}))};
}

function trimmed(value: unknown, max: number) {
  if (typeof value !== "string") throw new Error("Eine Bezeichnung fehlt.");
  const text = value.normalize("NFC").trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/u.test(text)) throw new Error("Ungültige Bezeichnung.");
  return text;
}
function normal(value: string) { return value.trim().normalize("NFC").toLocaleLowerCase("de-DE"); }

function exact<T extends {name: string}>(items: T[], name: string) {
  const found = items.filter(i => normal(i.name) === normal(name));
  if (found.length !== 1) throw new Error(found.length ? "Die Bezeichnung ist mehrdeutig." : "Der angegebene Eintrag wurde nicht gefunden.");
  return found[0];
}

function parseActions(value: unknown): FinanceAction[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) throw new Error("Ein bis zehn Änderungen sind möglich.");
  return value.map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Ungültige Änderung.");
    const item = raw as Record<string, unknown>, name = trimmed(item.name, 120);
    if (item.type === "checkin") {
      if (Object.keys(item).some(k => !["type","name","balance"].includes(k))) throw new Error("Unbekanntes Feld beim Check-in.");
      return {type: item.type, name, balance: money(item.balance)};
    }
    const amount = money(item.amount);
    if (amount < 0) throw new Error("Der Betrag muss positiv oder null sein.");
    if (item.type === "rate" && validCalendarDay(item.effectiveDate) &&
        Object.keys(item).every(k => ["type","name","amount","effectiveDate"].includes(k))) {
      return {type: item.type, name, amount, effectiveDate: item.effectiveDate};
    }
    if (item.type === "invoice" && amount > 0 && validCalendarDay(item.dueDate) &&
        Object.keys(item).every(k => ["type","name","amount","dueDate","category"].includes(k))) {
      return {type: item.type, name, amount, dueDate: item.dueDate, category: trimmed(item.category ?? "Sonstige", 80)};
    }
    throw new Error("Bitte Art der Änderung, Betrag und gültiges Datum angeben.");
  });
}

function processChanges(value: unknown, proposed: unknown, now: Date) {
  const plan = structuredClone(planData(value));
  const day = localISO(berlinDate(now));
  const actions = parseActions(proposed), preview: string[] = [];
  const touched = new Set<string>();
  const claim = (key: string) => {
    if (touched.has(key)) throw new Error("Der Vorschlag enthält mehrere Änderungen am selben Posten.");
    touched.add(key);
  };
  let checkin = false;
  for (const action of actions) {
    if (action.type === "invoice") {
      const {name, amount, dueDate, category = "Sonstige"} = action;
      if (plan.expenses.some(e => e.frequency === "once" && normal(e.name) === normal(name) && e.amount === amount && e.dueDate === dueDate)) {
        throw new Error("Eine identische Rechnung ist bereits im Plan.");
      }
      plan.expenses.push({id: crypto.randomUUID(), name, amount, category, frequency: "once", dueDate, paid: false});
      preview.push(name + " · Einmalige offene Rechnung · " + euro.format(amount) + " · fällig " + dueDate + " · " + category);
    } else if (action.type === "rate") {
      const entry = exact(plan.expenses.filter(e => (e.frequency ?? "monthly") === "monthly"), action.name);
      claim("rate:" + entry.id);
      if (action.effectiveDate < day) throw new Error("Eine Änderung kann ab heute oder zu einem zukünftigen Stichtag gelten.");
      const before = expenseAmount(entry, action.effectiveDate);
      if (before === action.amount) throw new Error("Dieser Monatsbetrag ist zum Stichtag bereits eingetragen.");
      // Keep already scheduled later changes. Replacing an existing date is explicit in the preview.
      entry.rateChanges = [...(entry.rateChanges ?? []).filter(rate => rate.date !== action.effectiveDate),
        {date: action.effectiveDate, amount: action.amount}].sort((a,b) => a.date.localeCompare(b.date));
      preview.push(entry.name + " · Monatsbetrag ab " + action.effectiveDate + " · " + euro.format(before) + " → " + euro.format(action.amount));
    } else {
      const account = exact(plan.accounts, action.name);
      claim("balance:" + account.id);
      if (account.type === "credit" && action.balance > 0) throw new Error("Bitte offenen Kreditkartensaldo mit Minuszeichen angeben.");
      const oldBalance = account.type === "credit" ? -account.balance : account.balance;
      account.balance = account.type === "credit" ? -action.balance : action.balance;
      preview.push(account.name + " · Kontostand am " + day + " · " + euro.format(oldBalance) + " → " + euro.format(action.balance));
      checkin = true;
    }
  }
  if (checkin) {
    const previous = plan.snapshots.find(s => s.date === day);
    const balances = Object.fromEntries(plan.accounts.map(a => [a.id, a.balance]));
    const snapshot = {...previous, id: previous?.id ?? crypto.randomUUID(), date: day, balances, netBalance: netBalance(plan), note: previous?.note ?? ""};
    plan.snapshots = [...plan.snapshots.filter(s => s.date !== day), snapshot].sort((a,b) => a.date.localeCompare(b.date));
  }
  if (!isPlan(plan)) throw new Error("Die Änderung würde die Grenzen deines Finanzplans überschreiten.");
  return {plan, actions, preview};
}
export function prepareChanges(value: unknown, proposed: unknown, now = new Date()) {
  const {actions, preview} = processChanges(value, proposed, now);
  return {actions, preview};
}
export function applyChanges(value: unknown, proposed: unknown, now = new Date()) {
  return processChanges(value, proposed, now).plan;
}
