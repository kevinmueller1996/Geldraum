import type { RevenueVAT } from "./revenue-vat";

export type ConfirmedRevenue = {name: string; month: string; vat: RevenueVAT};
type Forecast = Record<string, ConfirmedRevenue> | undefined;

export function confirmedForMonth(forecast: Forecast, month: string, basis: "gross" | "net") {
  let cents = 0;
  for (const entry of Object.values(forecast ?? {})) {
    if (entry.month === month) cents += Math.round(entry.vat[basis] * 100);
  }
  return cents / 100;
}

export function planningMonths(forecast: Forecast, currentMonth: string) {
  const months = new Set(Object.values(forecast ?? {}).map(entry => entry.month));
  const first = new Date(currentMonth + "-01T12:00:00Z");
  for (let offset = 0; offset < 12; offset++) {
    months.add(first.toISOString().slice(0, 7));
    first.setUTCMonth(first.getUTCMonth() + 1);
  }
  return [...months].sort();
}
