import { parseAmount } from "./amount";
import { grossFromNet, netFromGross, type VatBasis } from "./recurring-costs";

export type RevenueVAT = { gross: number; net: number; basis: VatBasis; rate?: number };
export type RevenuePlan = { monthlyRevenue?: Record<string, number>; monthlyRevenueVAT?: Record<string, RevenueVAT> };
export type RevenueDraft = { basis: VatBasis; amount: string; method: "rate" | "tax"; tax: string; originalGross?: number };
const editable = (value: number | undefined) => value === undefined ? "" : String(value).replace(".", ",");
const difference = (a: number, b: number) => (Math.round(a * 100) - Math.round(b * 100)) / 100;

export function revenueValue(plan: RevenuePlan, month: string, basis: VatBasis) {
  const net = plan.monthlyRevenue?.[month];
  const meta = plan.monthlyRevenueVAT?.[month];
  return basis === "net" ? net : meta && meta.net === net ? meta.gross : undefined;
}
export function revenueDraft(plan: RevenuePlan, month: string): RevenueDraft {
  const net = revenueValue(plan, month, "net"), gross = revenueValue(plan, month, "gross");
  const meta = gross === undefined ? undefined : plan.monthlyRevenueVAT?.[month];
  return draftFromRevenue(net, meta);
}
export function draftFromRevenue(net?: number, meta?: RevenueVAT): RevenueDraft {
  const gross = meta?.gross;
  const basis = meta?.basis ?? (net === undefined ? "gross" : "net");
  return { basis, amount: editable(basis === "gross" ? gross : net), method: meta && meta.rate === undefined ? "tax" : "rate",
    tax: editable(meta && (meta.rate ?? difference(meta.gross, meta.net))), originalGross: gross };
}
export function revenueAmounts(draft: RevenueDraft): { net: number; meta?: RevenueVAT } | null {
  const amount = draft.amount.trim() ? parseAmount(draft.amount) : null;
  if (amount === null) return null;
  if (!draft.tax.trim()) return draft.basis === "net" ? { net: amount } : null;
  const tax = parseAmount(draft.tax);
  if (Number(amount.toFixed(2)) !== amount || tax === null || Number(tax.toFixed(2)) !== tax || (draft.method === "rate" && (!/^\d{0,3}([.,]\d{0,2})?$/.test(draft.tax) || tax < 0 || tax > 100))) return null;
  const net = draft.basis === "net" ? amount : draft.method === "tax" ? difference(amount, tax) : netFromGross(amount, tax);
  const gross = draft.basis === "gross" ? amount : draft.method === "tax" ? difference(amount, -tax)
    : draft.originalGross !== undefined && netFromGross(draft.originalGross, tax) === net ? draft.originalGross : grossFromNet(net, tax);
  if (Math.abs(gross) > 1e9 || Math.abs(net) > 1e9) return null;
  return { net, meta: { net, gross, basis: draft.basis, ...(draft.method === "rate" ? { rate: tax } : {}) } };
}
export function switchRevenueBasis(draft: RevenueDraft, basis: VatBasis): RevenueDraft {
  if (basis === draft.basis) return draft;
  const pair = revenueAmounts(draft)?.meta;
  if (!pair && draft.amount.trim()) return draft;
  return { ...draft, basis, amount: editable(pair?.[basis]), originalGross: pair?.gross };
}
export function withRevenue<T extends RevenuePlan>(plan: T, month: string, value: NonNullable<ReturnType<typeof revenueAmounts>>): T {
  const monthlyRevenueVAT = { ...plan.monthlyRevenueVAT };
  if (value.meta) monthlyRevenueVAT[month] = value.meta;
  else delete monthlyRevenueVAT[month];
  return { ...plan, monthlyRevenue: { ...plan.monthlyRevenue, [month]: value.net }, monthlyRevenueVAT };
}
