function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isText(value: unknown, max = 160) {
  return typeof value === "string" && value.length <= max;
}

function isMoney(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000;
}

function validBookingDay(day: unknown) {
  return day === undefined || (Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 31);
}

export function validCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validExpenseSchedule(item: Record<string, unknown>) {
  const frequency = item.frequency ?? "monthly";
  if (item.rateChanges !== undefined) {
    if (frequency !== "monthly" || !Array.isArray(item.rateChanges) || item.rateChanges.length > 60 ||
      !item.rateChanges.every(rate => isRecord(rate) && validCalendarDay(rate.date) && isMoney(rate.amount)) ||
      new Set(item.rateChanges.map(rate => rate.date)).size !== item.rateChanges.length) return false;
  }
  if (frequency === "once") return validCalendarDay(item.dueDate) && (item.paid === undefined || typeof item.paid === "boolean");
  return ["monthly", "quarterly", "annual"].includes(String(frequency))
    && ((frequency === "monthly" && item.month === undefined)
      || (Number.isInteger(item.month) && Number(item.month) >= 0 && Number(item.month) < 12));
}

function validList(value: unknown, max: number, validator: (item: Record<string, unknown>) => boolean) {
  return Array.isArray(value) && value.length <= max && value.every((item) => isRecord(item) && typeof item.id === "string" && item.id.length > 0 && validator(item))
    && new Set(value.map((item) => item.id)).size === value.length;
}

export function isPlan(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !isText(value.name, 80)) return false;
  if (value.scenario !== undefined && (!isRecord(value.scenario) || !isText(value.scenario.name) || !isMoney(value.scenario.cost) || !isMoney(value.scenario.equity))) return false;
  if (value.monthlyRevenue !== undefined && (!isRecord(value.monthlyRevenue) || !Object.entries(value.monthlyRevenue).every(([month, amount]) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && isMoney(amount)))) return false;
  if (value.liquidity !== undefined && !isMoney(value.liquidity)) return false;
  if (value.categoryColors !== undefined && (!isRecord(value.categoryColors) || !Object.values(value.categoryColors).every((color) => isText(color, 80)))) return false;
  if (value.checkInCadence !== undefined && !["weekly", "daily"].includes(String(value.checkInCadence))) return false;
  return validList(value.incomes, 50, (item) => isText(item.id, 100) && isText(item.name, 120) && isMoney(item.amount) && typeof item.annual === "boolean" && validBookingDay(item.bookingDay) && (item.month === undefined || (Number.isInteger(item.month) && Number(item.month) >= 0 && Number(item.month) <= 11)))
    && validList(value.expenses, 250, (item) => isText(item.id, 100) && isText(item.name, 120) && isMoney(item.amount) && isText(item.category, 80) && validExpenseSchedule(item) && validBookingDay(item.bookingDay))
    && validList(value.annualCosts, 100, (item) => isText(item.id, 100) && isText(item.name, 120) && isMoney(item.amount) && Number.isInteger(item.month) && Number(item.month) >= 0 && Number(item.month) <= 11 && validBookingDay(item.bookingDay) && (item.category === undefined || isText(item.category, 80)))
    && validList(value.commitments, 100, (item) => isText(item.id, 100) && isText(item.name, 120) && isMoney(item.balance) && isMoney(item.payment) && (item.originalPrincipal === undefined || (isMoney(item.originalPrincipal) && Number(item.originalPrincipal) > 0)) && (item.balanceDate === undefined || validCalendarDay(item.balanceDate)) && (item.paidBefore === undefined || (isMoney(item.paidBefore) && Number(item.paidBefore) >= 0)) && validBookingDay(item.bookingDay) && (item.category === undefined || isText(item.category, 80)) && (item.interestRate === undefined || isMoney(item.interestRate)) && (item.extraPayment === undefined || isMoney(item.extraPayment)) && (item.termMonths === undefined || (Number.isInteger(item.termMonths) && Number(item.termMonths) >= 0)))
    && validList(value.goals, 100, (item) => isText(item.id, 100) && isText(item.name, 120) && isMoney(item.target) && isMoney(item.saved) && (item.monthly === undefined || isMoney(item.monthly)) && (item.targetDate === undefined || item.targetDate === "" || validCalendarDay(item.targetDate)))
    && validList(value.savings, 100, (item) => isText(item.id, 100) && isText(item.name, 120) && ["security", "dayMoney", "fixedDeposit", "buildingSavings", "cash", "other"].includes(String(item.kind)) && isMoney(item.balance)
      && validDepreciation(item)
      && (item.kind !== "security" || (isText(item.symbol, 30) && isMoney(item.quantity) && isMoney(item.price) && isMoney(item.priceEur) && isText(item.currency, 10)
        && (item.quoteUpdatedAt === undefined || isText(item.quoteUpdatedAt, 40))
        && (item.quoteVenue === undefined || isText(item.quoteVenue, 80)))))
    && validList(value.accounts, 30, (item) => isText(item.id, 100) && isText(item.name, 120) && (item.type === "bank" || item.type === "credit" || item.type === "cash") && validBookingDay(item.bookingDay) && isMoney(item.balance)
      && (item.category === undefined || isText(item.category, 80))
      && (item.monthlyPayment === undefined || (isMoney(item.monthlyPayment) && Number(item.monthlyPayment) >= 0)))
    && validList(value.snapshots, 500, (item) => isText(item.id, 100) && validCalendarDay(item.date) && isRecord(item.balances) && Object.values(item.balances).every(isMoney) && isText(item.note, 500) && (item.netBalance === undefined || isMoney(item.netBalance)));
}

export function backupPlan(value: unknown) {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) return null;
  // Savings was introduced after the original plan export format.
  const candidate = { ...value, savings: value.savings === undefined ? [] : value.savings };
  return isPlan(candidate) ? candidate : null;
}

export function validDepreciation(item: Record<string, unknown>) {
  if (item.depreciationStart === undefined) return item.usefulLifeMonths === undefined && item.residualValue === undefined;
  return item.kind === "other" && typeof item.depreciationStart === "string"
    && /^\d{4}-(0[1-9]|1[0-2])$/.test(item.depreciationStart) && !item.depreciationStart.startsWith("0000")
    && isMoney(item.balance) && Number(item.balance) > 0 && Number.isInteger(item.usefulLifeMonths)
    && Number(item.usefulLifeMonths) >= 1 && Number(item.usefulLifeMonths) <= 1200
    && isMoney(item.residualValue) && Number(item.residualValue) >= 0 && Number(item.residualValue) <= Number(item.balance);
}
