export type AssetBasis = { kind: string; balance: number; depreciationStart?: string; usefulLifeMonths?: number; residualValue?: number };

function monthIndex(key: string) {
  return Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;
}

// A month-end projection. Keep the original basis intact and round the cumulative charge to cents.
export function depreciation(asset: AssetBasis, month: string) {
  if (asset.kind !== "other" || !asset.depreciationStart || !asset.usefulLifeMonths) return null;
  const cost = Math.round(asset.balance * 100);
  const residual = Math.round((asset.residualValue ?? 0) * 100);
  const duration = asset.usefulLifeMonths;
  const age = monthIndex(month) - monthIndex(asset.depreciationStart) + 1;
  const expense = Math.round((cost - residual) * Math.min(duration, Math.max(0, age)) / duration);
  return { book: age < 1 ? 0 : (cost - expense) / 100, monthly: (cost - residual) / duration / 100 };
}
