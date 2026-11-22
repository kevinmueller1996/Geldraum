import type { Plan } from "../page";

export const closeVenue = "Cboe Europe (DXE) · Schlusskurs";
export type ClosingPrices = { asOf: string; prices: Record<string, number> };

export function securityISIN(symbol?: string) {
  const value = symbol?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(value) ? value : "";
}

export function applyClosingPrices(plan: Plan | null, data?: ClosingPrices | null): Plan | null {
  if (!plan || !data) return plan;
  let changed = false;
  const savings = plan.savings.map(item => {
    const price = data.prices[securityISIN(item.symbol)];
    if (item.kind !== "security" || !Number.isFinite(price) || price <= 0) return item;
    // A manual valuation entered after this daily file must survive a sync.
    // Imported and native timestamps are ISO dates or UTC ISO timestamps.
    const previousDay = item.quoteUpdatedAt?.slice(0, 10);
    if (previousDay && (previousDay > data.asOf || (item.quoteVenue === "Manuell" && previousDay === data.asOf))) return item;
    if (item.quoteVenue === closeVenue && item.quoteUpdatedAt === data.asOf && item.priceEur === price) return item;
    changed = true;
    return { ...item, price, priceEur: price, currency: "EUR", quoteVenue: closeVenue, quoteUpdatedAt: data.asOf };
  });
  return changed ? { ...plan, savings } : plan;
}
