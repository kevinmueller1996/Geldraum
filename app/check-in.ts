import type { Plan } from "./page";

type Account = Plan["accounts"][number];
type Snapshot = Plan["snapshots"][number];

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
