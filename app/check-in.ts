import type { Plan } from "./page";

type Account = Plan["accounts"][number];
type Snapshot = Plan["snapshots"][number];

/** Check-in dates are local ISO calendar dates, independent of the browser's timezone. */
export function previousRevenueMonth(date: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date)) return "";
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7));
  return month === 1 ? String(year - 1).padStart(4, "0") + "-12" : date.slice(0, 5) + String(month - 1).padStart(2, "0");
}

export function revenueMonthLabel(month: string) {
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(month + "-01T12:00:00Z"));
}

function net(accounts: Account[]) {
  return accounts.reduce((sum, account) => sum + (account.type === "credit" ? -account.balance : account.balance), 0);
}

export function checkInFields(plan: Plan, date: string, today: string) {
  const previous = plan.snapshots.find(snapshot => snapshot.date === date);
  const historical = date !== today && previous;
  const accounts = historical
    ? plan.accounts.filter(account => Object.hasOwn(historical.balances, account.id)).map(account => ({
      ...account, balance: historical.balances[account.id],
    }))
    : plan.accounts.map(account => ({ ...account }));
  return { accounts, note: previous?.note ?? "" };
}

export function checkInRecord(plan: Plan, date: string, today: string, accounts: Account[], note: string, id: string): Snapshot {
  const previous = plan.snapshots.find(snapshot => snapshot.date === date);
  const balances = Object.fromEntries(accounts.map(account => [account.id, account.balance]));
  let netBalance = net(accounts);
  if (date !== today && previous) {
    // A stored total can include accounts that were removed after this check-in.
    // Apply only the change in the entries the user can still edit.
    if (previous.netBalance !== undefined) {
      const oldVisible = accounts.map(account => ({ ...account, balance: previous.balances[account.id] ?? 0 }));
      netBalance = previous.netBalance + (netBalance - net(oldVisible));
    }
    return { ...previous, balances: { ...previous.balances, ...balances }, netBalance, note: note.trim() };
  }
  return { id: previous?.id ?? id, date, balances, netBalance, note: note.trim() };
}

export function revenueStats(revenue: Record<string, number>, today: string) {
  const months: string[] = [];
  let month = previousRevenueMonth(today);
  for (let i = 0; i < 12; i++) {
    months.push(month);
    month = previousRevenueMonth(month + "-01");
  }
  const values = months.flatMap(key => revenue[key] === undefined ? [] : [revenue[key]]);
  return { months, count: values.length, total: values.reduce((sum, value) => sum + value, 0),
    min: Math.min(0, ...values), max: Math.max(0, ...values) };
}
