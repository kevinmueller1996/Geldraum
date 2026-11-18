function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isText(value: unknown, max = 160) {
  return typeof value === "string" && value.length <= max;
}

function isMoney(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000;
}

function validList(value: unknown, max: number, validator: (item: Record<string, unknown>) => boolean) {
  return Array.isArray(value) && value.length <= max && value.every((item) => isRecord(item) && typeof item.id === "string" && item.id.length > 0 && validator(item))
    && new Set(value.map((item) => item.id)).size === value.length;
}

export function isPlan(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !isText(value.name, 80)) return false;
  if (value.scenario !== undefined && (!isRecord(value.scenario) || !isText(value.scenario.name) || !isMoney(value.scenario.cost) || !isMoney(value.scenario.equity))) return false;
  if (value.liquidity !== undefined && !isMoney(value.liquidity)) return false;
  if (value.categoryColors !== undefined && (!isRecord(value.categoryColors) || !Object.values(value.categoryColors).every((color) => isText(color, 80)))) return false;
  if (value.checkInCadence !== undefined && !["weekly", "daily"].includes(String(value.checkInCadence))) return false;
  return validList(value.incomes, 50, (item) => isText(item.id, 100) && isText(item.name, 120) && isMoney(item.amount) && typeof item.annual === "boolean" && (item.month === undefined || (Number.isInteger(item.month) && Number(item.month) >= 0 && Number(item.month) <= 11)))
    && validList(value.expenses, 250, (item) => isText(item.id, 100) && isText(item.name, 120) && isMoney(item.amount) && isText(item.category, 80) && (item.bookingDay === undefined || (Number.isInteger(item.bookingDay) && Number(item.bookingDay) >= 0 && Number(item.bookingDay) <= 31)))
    && validList(value.annualCosts, 100, (item) => isText(item.id, 100) && isText(item.name, 120) && isMoney(item.amount) && Number.isInteger(item.month) && Number(item.month) >= 0 && Number(item.month) <= 11)
    && validList(value.commitments, 100, (item) => isText(item.id, 100) && isText(item.name, 120) && isMoney(item.balance) && isMoney(item.payment) && (item.interestRate === undefined || isMoney(item.interestRate)) && (item.extraPayment === undefined || isMoney(item.extraPayment)) && (item.termMonths === undefined || (Number.isInteger(item.termMonths) && Number(item.termMonths) >= 0)))
    && validList(value.goals, 100, (item) => isText(item.id, 100) && isText(item.name, 120) && isMoney(item.target) && isMoney(item.saved) && (item.monthly === undefined || isMoney(item.monthly)) && (item.targetDate === undefined || isText(item.targetDate, 20)))
    && validList(value.savings, 100, (item) => isText(item.id, 100) && isText(item.name, 120) && ["security", "dayMoney", "fixedDeposit", "buildingSavings", "cash", "other"].includes(String(item.kind)) && isMoney(item.balance)
      && (item.kind !== "security" || (isText(item.symbol, 30) && isMoney(item.quantity) && isMoney(item.price) && isMoney(item.priceEur) && isText(item.currency, 10)
        && (item.quoteUpdatedAt === undefined || isText(item.quoteUpdatedAt, 40))
        && (item.quoteVenue === undefined || isText(item.quoteVenue, 80)))))
    && validList(value.accounts, 30, (item) => isText(item.id, 100) && isText(item.name, 120) && (item.type === "bank" || item.type === "credit" || item.type === "cash") && isMoney(item.balance))
    && validList(value.snapshots, 500, (item) => isText(item.id, 100) && isText(item.date, 20) && isRecord(item.balances) && Object.values(item.balances).every(isMoney) && isText(item.note, 500) && (item.netBalance === undefined || isMoney(item.netBalance)));
}

export function backupPlan(value: unknown) {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) return null;
  // Savings was introduced after the original plan export format.
  const candidate = { ...value, savings: value.savings === undefined ? [] : value.savings };
  return isPlan(candidate) ? candidate : null;
}
