"use client";

import { sharing, ShareError, type Access } from "./freigaben/client";
import { UiIcon, type IconName } from "./ui-icon";
import { applyClosingPrices, closeVenue, securityISIN, type ClosingPrices } from "./market/closing-prices";
import { currentSession, offlineCopy, updateCopy, mergeDraft, reconcile, bindBrowserCopy, differentAccount, pending, Conflict, SessionChanged, type Copy, type Remote, type Choice } from "./browser-plan";
import { expireMarker } from "./browser-session";
import Image from "next/image";
import { useBrowserReady } from "./browser-runtime";
import { Capacitor } from "@capacitor/core";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { currentLoan, forecastLoans, loanSchedule } from "./loan-schedule";
import { loanProjection, monthlyLoanPayment } from "./loan-projection";
import { revenueDraft, revenueAmounts, revenueValue, withRevenue, type RevenueDraft, type RevenueVAT } from "./revenue-vat";
import { RevenueFields } from "./revenue-fields";
import { checkInFields, checkInRecord, previousRevenueMonth, revenueMonthLabel } from "./check-in";
import { backupPlan, isPlan, validCalendarDay, validDepreciation } from "./plan-validation";
import RevenueHistory from "./revenue-history";
import BalanceHistory from "./balance-history";
import DepreciationFields from "./depreciation-fields";
import { depreciation, type AssetBasis } from "./depreciation";
import DecimalInput from "./decimal-input";
import InstallAppCard from "./install-app-card";
import { AppearancePicker, useAppearance } from "./appearance-picker";
import BillingOffer, { type BillingStatus } from "./billing/offer";
import LegalLinks from "./legal-links";
import { isLocalHostname } from "./local-host";
import NativeSettingsCard from "./native-settings-card";

type IncomeSource = { vatBasis?: VatBasis; vatRate?: number; bookingDay?: number; id: string; name: string; amount: number; annual: boolean; month?: number };
import { flexibleMonthlyBudget, type FlexibleCost, grossFromNet, netFromGross, type VatBasis, byDueDate, byTargetDate, standardExpenseCategories as categories, expenseCategoryResolver, frequencies, expenseAmount, averageMonthlyCosts, isExpenseDue, monthEndForecast, unifiedExpenses, storagePlan, type Expense, type AnnualCost, type Frequency, type ForecastRow } from "./recurring-costs";

type Commitment = { highPriority?: boolean; originalPrincipal?: number; balanceDate?: string; paidBefore?: number; bookingDay?: number; category?: string; id: string; name: string; balance: number; payment: number; interestRate?: number; termMonths?: number; extraPayment?: number };
type Goal = { id: string; name: string; target: number; saved: number; monthly: number; targetDate?: string };
type SavingKind = "security" | "dayMoney" | "fixedDeposit" | "buildingSavings" | "cash" | "other";
type SavingAsset = AssetBasis & { id: string; name: string; kind: SavingKind; balance: number; symbol?: string; quantity?: number; price?: number; priceEur?: number; currency?: string; quoteUpdatedAt?: string; quoteVenue?: string };
type Account = { bookingDay?: number; id: string; name: string; type: "bank" | "credit" | "cash"; balance: number; monthlyPayment?: number; category?: string };
type Snapshot = { id: string; date: string; balances: Record<string, number>; note: string; netBalance?: number };
type View = "revenue" | "home" | "expenses" | "month" | "loans" | "goals" | "more";
type EditorScope = "flexible" | "accounts" | "income" | "expenses" | "specials" | "loans" | "goals" | "savings";
export type Plan = {
  monthlyRevenue?: Record<string, number>;
  monthlyRevenueVAT?: Record<string, RevenueVAT>;
  name: string;
  liquidity: number;
  categoryColors: Record<string, string>;
  incomes: IncomeSource[];
  expenses: Expense[];
  flexibleCosts: FlexibleCost[];
  annualCosts: AnnualCost[];
  commitments: Commitment[];
  goals: Goal[];
  savings: SavingAsset[];
  accounts: Account[];
  snapshots: Snapshot[];
  checkInCadence: "daily" | "weekly";
  scenario: { name: string; cost: number; equity: number };
};
export type CloudUser = { dashboardBasis?: VatBasis; displayName: string; email: string; local?: boolean; accountCreatedAt?: string };
type AuthStatus = "loading" | "authenticated" | "anonymous" | "unavailable";
type SyncStatus = "idle" | "saving" | "saved" | "pending" | "offline" | "error" | "conflict";

const STORAGE_KEY = "klarbudget-plan-v3";
const PREVIOUS_STORAGE_KEY = "klarbudget-plan-v2";
const OLD_STORAGE_KEY = "klarbudget-profile";
const months = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const businessSteps = ["Basis", "Konten", "Einkommen", "Ausgaben", "Kredite"] as const;
const privateSteps = [...businessSteps, "Ziele"] as const;
const savingKindLabels: Record<SavingKind, string> = {
  security: "Aktie oder ETF",
  dayMoney: "Tagesgeldkonto",
  fixedDeposit: "Festgeld",
  buildingSavings: "Bausparvertrag",
  cash: "Bargeldreserve",
  other: "Andere Ersparnis",
};
const savingKindColors: Record<SavingKind, string> = {
  security: "#4d231e",
  dayMoney: "#718767",
  fixedDeposit: "#be893e",
  buildingSavings: "#826c8d",
  cash: "#5d7885",
  other: "#cf624e",
};
const defaultCategoryColors: Record<string, string> = {
  Wohnen: "#805044",
  Versicherungen: "#826c8d",
  Mobilität: "#be893e",
  Kommunikation: "#5d7885",
  Lebenshaltung: "#718767",
  "Abos & Sonstiges": "#a76158",
};

const demoPlan: Plan = {
  name: "Du",
  liquidity: 8400,
  categoryColors: { ...defaultCategoryColors },
  incomes: [{ id: "demo-income", name: "Nettoeinkommen", amount: 4200, annual: false }],
  expenses: [
    { id: "demo-home", name: "Wohnen", amount: 1250, category: "Wohnen" },
    { id: "demo-life", name: "Lebenshaltung", amount: 620, category: "Lebenshaltung" },
    { id: "demo-other", name: "Weitere Fixkosten", amount: 430, category: "Abos & Sonstiges" },
  ],
  flexibleCosts: [],
  annualCosts: [
    { id: "demo-car", name: "Versicherungen", amount: 720, month: 3 },
    { id: "demo-tax", name: "Jahresbeiträge", amount: 360, month: 11 },
  ],
  commitments: [{ id: "demo-loan", name: "Finanzierung", balance: 7800, payment: 240 }],
  goals: [
    { id: "demo-buffer", name: "Notgroschen", target: 12000, saved: 8400, monthly: 300 },
    { id: "demo-trip", name: "Großer Wunsch", target: 6000, saved: 1800, monthly: 250 },
  ],
  savings: [],
  accounts: [
    { id: "demo-bank", name: "Girokonto", type: "bank", balance: 3850 },
    { id: "demo-card", name: "Kreditkarte", type: "credit", balance: 620 },
  ],
  snapshots: [],
  checkInCadence: "weekly",
  scenario: { name: "Großes Projekt", cost: 50000, equity: 15000 },
};

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const roundedEuros = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const incomePercent = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 1 });
const exactEuros = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

function euro(value: number, exact = false) {
  return (exact && !Number.isInteger(value) ? exactEuros : roundedEuros).format(value || 0);
}

function marketPrice(value: number, currency = "EUR") {
  try {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
  } catch {
    return `${(value || 0).toFixed(2)} ${currency}`;
  }
}

function savingValue(item: SavingAsset) {
  return item.kind === "security"
    ? Math.max(item.quantity ?? 0, 0) * Math.max(item.priceEur ?? 0, 0)
    : Math.max(item.balance, 0);
}

function savingPriceLabel(item: SavingAsset) {
  if (item.quoteVenue === closeVenue && item.quoteUpdatedAt) {
    const day = new Date(item.quoteUpdatedAt + "T12:00:00Z");
    if (Number.isFinite(day.getTime())) return closeVenue + " · Datenstand " + day.toLocaleDateString("de-DE", {timeZone:"UTC"});
  }
  return [item.quoteVenue, item.quoteUpdatedAt && dateTimeLabel(item.quoteUpdatedAt)].filter(Boolean).join(" · ");
}

function dateTimeLabel(value?: string) {
  if (!value) return "unbekannt";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split("-").reverse().join(".");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unbekannt" : new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "medium" }).format(date);
}

function numberValue(value: string) {
  return Number(value.replace(",", ".")) || 0;
}

function localDay(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function goalMonthlyNeed(goal: Goal) {
  if (!validCalendarDay(goal.targetDate)) return 0;
  const target = new Date(`${goal.targetDate}T12:00:00`);
  const now = new Date();
  if (Number.isNaN(target.getTime()) || target <= now) return Math.max(goal.target - goal.saved, 0);
  const monthDistance = (target.getFullYear() - now.getFullYear()) * 12 + target.getMonth() - now.getMonth();
  const monthsLeft = Math.max(monthDistance + (target.getDate() >= now.getDate() ? 1 : 0), 1);
  return Math.max(goal.target - goal.saved, 0) / monthsLeft;
}

function emptyPlan(name = ""): Plan {
  return {
    name,
    liquidity: 0,
    categoryColors: { ...defaultCategoryColors },
    incomes: [{ id: uid(), name: "Nettoeinkommen", amount: 0, annual: false }],
    flexibleCosts: [],
    expenses: [{ id: uid(), name: "Fixkosten", amount: 0, category: "Wohnen", bookingDay: 0 }],
    annualCosts: [],
    commitments: [],
    goals: [],
    savings: [],
    accounts: [
      { id: uid(), name: "Girokonto", type: "bank", balance: 0 },
      { id: uid(), name: "Kreditkarte", type: "credit", balance: 0 },
    ],
    snapshots: [],
    checkInCadence: "weekly",
    scenario: { name: "Großes Projekt", cost: 0, equity: 0 },
  };
}

function orderedPlan(plan: Plan): Plan {
  return { ...plan, flexibleCosts: plan.flexibleCosts ?? [],
    incomes: [...plan.incomes].sort(byDueDate("incomes")),
    expenses: unifiedExpenses(plan.expenses, plan.annualCosts).sort(byDueDate("expenses")),
    annualCosts: [],
    commitments: [...plan.commitments].sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, "de")),
    goals: [...plan.goals].sort(byTargetDate),
  };
}

function normalizePlan(value: Partial<Plan>): Plan {
  const base = emptyPlan(value.name ?? "");
  const categoryName = expenseCategoryResolver();
  return {
    ...base,
    ...value,
    categoryColors: { ...defaultCategoryColors, ...(value.categoryColors ?? {}) },
    incomes: (value.incomes ?? base.incomes).map((item) => ({ ...item, month: item.annual ? item.month : undefined })),
    expenses: unifiedExpenses(value.expenses ?? base.expenses, value.annualCosts ?? []).map((item) => ({ ...item, bookingDay: item.bookingDay ?? 0 })),
    annualCosts: [],
    commitments: (value.commitments ?? []).map((item) => ({ ...item, ...(item.category && { category: categoryName(item.category.trim() || "Kreditraten") }), interestRate: item.interestRate ?? 0, termMonths: item.termMonths ?? 0, extraPayment: item.extraPayment ?? 0 })),
    goals: (value.goals ?? []).map((item) => ({ ...item, targetDate: item.targetDate ?? "" })),
    savings: (value.savings ?? []).map((item) => ({
      ...item,
      balance: item.balance ?? 0,
      symbol: item.kind === "security" ? (item.symbol ?? "").toUpperCase() : undefined,
      quantity: item.kind === "security" ? (item.quantity ?? 0) : undefined,
      price: item.kind === "security" ? (item.price ?? 0) : undefined,
      priceEur: item.kind === "security" ? (item.priceEur ?? item.price ?? 0) : undefined,
      currency: item.kind === "security" ? (item.currency ?? "EUR") : undefined,
    })),
    accounts: value.accounts ?? base.accounts,
    snapshots: value.snapshots ?? [],
    checkInCadence: value.checkInCadence ?? "weekly",
    scenario: value.scenario ?? base.scenario,
  };
}

function migrateOldProfile(): Plan | null {
  try {
    const old = window.localStorage.getItem(OLD_STORAGE_KEY);
    if (!old) return null;
    const value = JSON.parse(old) as { name?: string; income?: number; fixedCosts?: number };
    const plan = emptyPlan(value.name ?? "");
    plan.incomes[0].amount = value.income ?? 0;
    plan.expenses[0].amount = value.fixedCosts ?? 0;
    plan.expenses[0].name = "Bisherige Fixkosten";
    return normalizePlan(plan);
  } catch {
    return null;
  }
}

export default function Home() {
  const ready = useBrowserReady();
  if (!ready) return <main className="loading" aria-label="Njora wird geladen"><span className="loading-mark" /></main>;
  const query = new URLSearchParams(location.search);
  return <FinanceDashboard key={query.toString()} business={query.get("bereich") === "business"} grant={query.get("freigabe")} />;
}

function FinanceDashboard({ business, grant }: { business: boolean; grant:string|null }) {
  const space = business ? "business" : "private";
  const sharePath = "/freigaben?bereich="+space;
  const sharedRevision = useRef<number|null>(null);
  const [access,setAccess] = useState<Access>("view");
  const [sharedFailure,setSharedFailure] = useState("");
  const onboardingSteps = business ? businessSteps : privateSteps;
  const assetKinds = business ? { ...savingKindLabels, other: "Sonstiger Vermögenswert" } : savingKindLabels;
  const savingsTitle = business ? "Vermögenswerte" : "Deine Ersparnisse";
  const newSavingKind = business ? "other" : "dayMoney";
  const accountEndpoint = business ? "/api/account/business" : "/api/account";
  const appearance = useAppearance();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [otherWorkspaceName, setOtherWorkspaceName] = useState<string | null>(null);
  const currentName = plan?.name.trim() || (business ? "Business" : "Privat");
  const privateName = business ? otherWorkspaceName || "Privat" : currentName;
  const businessName = business ? currentName : otherWorkspaceName || "Business";
  const workspacePicker = grant !== null
    ? <a className="workspace-picker" href={sharePath}>{currentName} · Geteilt</a>
    : <select className="workspace-picker" aria-label="Finanzbereich" value={space}
        onChange={event => location.assign(event.target.value === "business" ? "/?bereich=business" : "/")}>
        <option value="private">{privateName}</option><option value="business">{businessName}</option>
      </select>;
  const [draft, setDraft] = useState<Plan>(emptyPlan());
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editorScope, setEditorScope] = useState<EditorScope | null>(null);
  const [editorTarget, setEditorTarget] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [savingsOpen, setSavingsOpen] = useState(false);
  const [showForecast, setShowForecast] = useState(false);
  const [costDetail, setCostDetail] = useState<{ category?: string; from: "home" | "month" }>({ from: "home" });
  const [activeView, setActiveView] = useState<View>("home");
  const [checkInAccounts, setCheckInAccounts] = useState<Account[]>([]);
  const [checkInDate, setCheckInDate] = useState("");
  const [revenueDrafts, setRevenueDrafts] = useState<Record<string, RevenueDraft>>({});
  const [comparisonOverride, setComparison] = useState<VatBasis | null>(null);
  const [sharedBasis, setSharedBasis] = useState<VatBasis>("gross");
  const [savingBasis, setSavingBasis] = useState(false);
  const [basisError, setBasisError] = useState("");
  const [checkInNote, setCheckInNote] = useState("");
  const [importPreview, setImportPreview] = useState<Plan | null>(null);
  const [importError, setImportError] = useState("");
  const [importText, setImportText] = useState("");
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null);
  const defaultBasis = grant ? sharedBasis : cloudUser?.dashboardBasis ?? "gross";
  const comparison = comparisonOverride ?? defaultBasis;
  const browserReady = useBrowserReady();
  const isLocalMode = browserReady && isLocalHostname(window.location.hostname);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const current = useRef<Copy | undefined>(undefined);
  const baseline = useRef<Plan | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const syncNow = useRef<() => void>(() => {});
  const clash = useRef<Remote | null>(null);
  const [problem, setProblem] = useState("");
  const [remoteUpdatedAt, setRemoteUpdatedAt] = useState<string | null>(null);
  const [legacyPlan, setLegacyPlan] = useState<Plan | null>(null);
  const [showLegacyPrompt, setShowLegacyPrompt] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingError, setOnboardingError] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (grant !== null) {
      async function loadShared() {
        try {
          const result = await sharing<{plan:Plan|null;revision:number|null;role:Access;dashboardBasis?:VatBasis}>(space,"plan",{id:grant});
          if(cancelled) return;
          const loaded = result.plan ? normalizePlan(result.plan) : null;
          setSharedBasis(result.dashboardBasis ?? "gross"); setAccess(result.role); setPlan(loaded); setReady(true);
          if(loaded) setDraft(loaded);
          sharedRevision.current=result.revision;
          setAuthStatus("authenticated"); setSyncStatus("saved");
          setSharedFailure(loaded ? "" : "In diesem Finanzbereich wurde noch kein Plan angelegt.");
        } catch(e) {
          if(cancelled) return;
          setPlan(null); setReady(true); setSharedFailure(e instanceof Error ? e.message : "Freigabe nicht erreichbar.");
        }
      }
      // Reload on return to recheck access. A suspended page must not restore a guest plan from cache.
      let requestNumber = 0;
      const checkAccess = async () => {
        if(document.hidden) return;
        const number = ++requestNumber;
        try {
          await sharing(space,"status",{id:grant});
        } catch(e) {
          if(cancelled || number!==requestNumber) return;
          if(e instanceof ShareError && [401,402,403,404,412].includes(e.status)) {
            setPlan(null); setDraft(emptyPlan()); setEditing(false); setCheckingIn(false); setSharedFailure(e.message);
          }
        }
      };
      const interval = window.setInterval(checkAccess,60000);
      document.addEventListener("visibilitychange",checkAccess);
      const returned = (e:PageTransitionEvent) => { if(e.persisted) location.reload(); };
      window.addEventListener("pageshow",returned);
      syncNow.current=()=>location.reload();
      void loadShared();
      return ()=>{cancelled=true;window.clearInterval(interval);document.removeEventListener("visibilitychange",checkAccess);window.removeEventListener("pageshow",returned);};
    }
    let running = false;
    let again = false;
    let delay = 2000;
    let timer: ReturnType<typeof setTimeout>;
    function leaveSession(path: "/login" | "/") {
      current.current = undefined;
      baseline.current = null;
      clash.current = null;
      setAuthStatus("anonymous");
      setPlan(null);
      location.replace(path);
    }

    function show(copy: Copy) {
      if (cancelled || copy.session !== currentSession()) return;
      if (current.current && differentAccount(current.current.user, copy.user)) {
        leaveSession("/");
        return;
      }
      const first = !current.current;
      current.current = copy;
      setBilling(copy.billing ?? null);
      setCloudUser(copy.user);
      setOtherWorkspaceName(copy.otherWorkspaceName?.trim() || null);
      setPlan(copy.draft);
      setAuthStatus("authenticated");
      setRemoteUpdatedAt(copy.updatedAt);
      setReady(true);
      if (first) {
        const initial = emptyPlan(business ? "" : copy.user.displayName.split(" ")[0] || "Mein Budget");
        if (business) {
          initial.incomes[0].name = "Betriebseinnahmen";
          initial.expenses[0].category = "Betriebskosten";
          initial.accounts = [{ id: uid(), name: "Geschäftskonto", type: "bank", balance: 0 }];
        }
        setDraft(copy.draft ?? initial);
        if (!business && !copy.draft) {
          try {
            const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(PREVIOUS_STORAGE_KEY);
            const legacy = saved ? normalizePlan(JSON.parse(saved)) : migrateOldProfile();
            if (legacy) { setLegacyPlan(legacy); setShowLegacyPrompt(true); }
          } catch { /* An unreadable legacy export does not affect the account. */ }
        }
      }
    }

    async function exchange() {
      if (cancelled) return;
      const previous = current.current;
      if (previous && previous.session !== currentSession()) { leaveSession("/"); return; }
      const headers: Record<string,string> = {"x-njora-browser": "1"};
      headers["x-njora-closing-prices"] = [...new Set(previous?.draft?.savings.filter(s => s.kind === "security").map(s => securityISIN(s.symbol)).filter(Boolean))].join(",") || "1";
      if (previous) headers["x-njora-browser-session"] = previous.session;
      const response = await fetch(accountEndpoint, {headers, cache: "no-store", signal: AbortSignal.timeout(15000)});
      if (cancelled) return;
      if (response.status === 401 || response.status === 412) {
        if (!previous || currentSession() === previous.session) document.cookie = expireMarker(location.href);
        leaveSession(response.status === 401 ? "/login" : "/");
        return;
      }
      if (!response.ok) throw new Error("Der Cloud-Abgleich ist gerade nicht möglich.");
      const { closingPrices:daily, ...reply } = await response.json() as Remote & {workspace?: string; closingPrices?:ClosingPrices | null};
      if (business && reply.workspace !== "business") throw new Error("Geschäftsbereich nicht verfügbar.");
      if (reply.plan) reply.plan = normalizePlan(reply.plan);
      const session = response.headers.get("x-njora-browser-session");
      if (!session || session !== currentSession() || (previous && reply.user.email !== previous.user.email)) throw new SessionChanged();
      const email = reply.user.email;
      let overlap = false;
      const copy = await updateCopy(email, session, saved => {
        const bound = bindBrowserCopy(saved, reply, session);
        try {
          const merged = reconcile(bound, reply);
          return {...merged, draft:applyClosingPrices(merged.draft, daily)};
        }
        catch (e) { if (!(e instanceof Conflict)) throw e; overlap = true; return bound; }
      }, false, business);
      if (!copy || cancelled) return;
      show(copy);
      if (overlap) { clash.current = reply; setSyncStatus("conflict"); return; }
      clash.current = null;
      if (copy.billing?.active === false || !pending(copy)) {
        setSyncStatus(pending(copy) ? "pending" : "saved"); setProblem(""); return;
      }
      const sent = await updateCopy(email, session, saved => {
        if (!saved || saved.session !== session) throw new SessionChanged();
        return {...saved, sending: saved.draft};
      }, false, business);
      if (!sent?.sending) return;
      const saved = await fetch(accountEndpoint, {method: "PUT", headers: {"Content-Type":"application/json", "x-njora-browser-session":session},
        body: JSON.stringify({plan:storagePlan(sent.sending), revision:sent.revision}), signal:AbortSignal.timeout(15000)});
      if (saved.status === 409 || saved.status === 401 || saved.status === 412 || saved.status === 402) throw new Error("Der Kontostand wird erneut geprüft.");
      if (!saved.ok) throw new Error(saved.status === 400 || saved.status === 413 ? "Der Finanzplan wurde von der Cloud abgelehnt. Bitte prüfe deine Eingaben." : "Die Cloud ist gerade nicht erreichbar.");
      const ack = await saved.json() as {revision:number; updatedAt:string};
      const latest = await updateCopy(email, session, stored => {
        if (!stored || stored.session !== session) throw new SessionChanged();
        if (stored.revision !== sent.revision) return stored;
        return {...stored, plan:sent.sending, sending:null, revision:ack.revision, updatedAt:ack.updatedAt};
      }, false, business);
      if (!latest || cancelled) return;
      show(latest);
      again ||= pending(latest);
      setSyncStatus(pending(latest) ? "pending" : "saved"); setProblem("");
    }

    async function sync() {
      clearTimeout(timer);
      if (running) { again = true; return; }
      if (cancelled) return;
      running = true;
      try {
        if (navigator.locks) await navigator.locks.request("njora-cloud-sync", exchange);
        else await exchange();
        delay = 2000;
      } catch (err) {
        if (cancelled) return;
        if (err instanceof SessionChanged && current.current) { leaveSession("/"); return; }
        if (!current.current) { setAuthStatus("unavailable"); setReady(true); }
        else {
          setSyncStatus(pending(current.current) ? "pending" : "offline");
          setProblem(err instanceof Error && err.message.startsWith("Der Finanzplan") ? err.message : "");
        }
        timer = setTimeout(sync, delay);
        delay = Math.min(delay * 2, 120000);
      } finally {
        running = false;
        if (!cancelled && again) { again = false; void sync(); }
      }
    }
    syncNow.current = () => { void sync(); };
    const resume = () => { if (!document.hidden) void sync(); };
    const changed = () => {
      if (current.current && current.current.session !== currentSession()) { leaveSession("/"); return; }
      resume();
    };
    const messages = typeof BroadcastChannel === "function" ? new BroadcastChannel("njora-finance") : null;
    channel.current = messages;
    if (messages) messages.onmessage = changed;
    const marketTimer = window.setInterval(() => {
      if (current.current?.draft?.savings.some(s => s.kind === "security" && securityISIN(s.symbol))) resume();
    }, 3600000);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", changed);
    window.addEventListener("storage", changed);
    document.addEventListener("visibilitychange", changed);
    void (async () => {
      try {
        const session = currentSession();
        const cached = session && await offlineCopy(session, business);
        if (cached && !cancelled) { show(cached); setSyncStatus(pending(cached) ? "pending" : "offline"); }
      } finally { if (!cancelled) void sync(); }
    })().catch(() => {});
    return () => { cancelled = true; clearInterval(marketTimer); messages?.close(); channel.current = null; clearTimeout(timer); window.removeEventListener("online",resume);
      window.removeEventListener("pageshow",changed); window.removeEventListener("storage",changed); document.removeEventListener("visibilitychange",changed); };
  }, [business, accountEndpoint, grant, space]);

  const hasPlan = Boolean(plan);
  const [today, setToday] = useState(() => localDay());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      setToday(localDay(now));
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(refresh, midnight.getTime() - now.getTime() + 50);
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);

  useEffect(() => {
    const modalOpen = !sharedFailure && billing?.active !== false && (checkingIn || editing || savingsOpen || showLegacyPrompt || (authStatus === "authenticated" && !hasPlan));
    if (!modalOpen) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary") ?? []).filter(el => el.getClientRects().length > 0);
    const focusTimer = window.setTimeout(() => focusable()[0]?.focus({ preventScroll: true }), 20);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (checkingIn) setCheckingIn(false);
        else if (savingsOpen) setSavingsOpen(false);
        else if (editing && hasPlan) { setEditing(false); setEditorScope(null); setEditorTarget(null); }
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sharedFailure, authStatus, billing?.active, checkingIn, editing, onboardingStep, hasPlan, savingsOpen, showLegacyPrompt]);

  const source = plan ?? demoPlan;
  const active = useMemo(() => orderedPlan({ ...source, commitments: source.commitments.map(loan => currentLoan(loan, today)) }), [source, today]);
  const categoryOptions = [...new Set([...(business ? ["Betriebskosten", "Personal", "Büro", "Software", "Marketing", "Versicherungen", "Mobilität", "Sonstige"] : categories), ...draft.expenses.map((item) => item.category), ...draft.commitments.flatMap(item => item.category ? [item.category] : [])])];
  const metrics = useMemo(() => {
    const now = new Date(today + "T12:00:00");
    const regularIncomes = active.incomes.filter(item => !item.annual);
    const netIncome = regularIncomes.reduce((sum, item) => sum + Math.round(netFromGross(item.amount, item.vatRate ?? 0) * 100), 0) / 100;
    const income = regularIncomes.reduce((sum, item) => sum + item.amount, 0);
    const annualIncome = active.incomes.filter((item) => item.annual).reduce((sum, item) => sum + item.amount, 0);
    const currentAnnualIncome = active.incomes.filter((item) => item.annual && item.month === now.getMonth()).reduce((sum, item) => sum + item.amount, 0);
    const payments = active.commitments.reduce((sum, item) => sum + monthlyLoanPayment(item), 0);
    const fixedCosts = averageMonthlyCosts(active.expenses, active.commitments, today);
    const goalNeed = active.goals.reduce((sum, item) => sum + goalMonthlyNeed(item), 0);
    const flexible = flexibleMonthlyBudget(active.flexibleCosts);
    const available = income - fixedCosts - flexible;
    const unallocated = available;
    const burden = income > 0 ? Math.round((fixedCosts / income) * 100) : 0;
    const bankBalance = active.accounts.filter((item) => item.type !== "credit").reduce((sum, item) => sum + item.balance, 0);
    const creditBalance = active.accounts.filter((item) => item.type === "credit").reduce((sum, item) => sum + item.balance, 0);
    const netBalance = bankBalance - creditBalance;
    const bufferMonths = fixedCosts > 0 ? netBalance / fixedCosts : 0;
    const currentMonthKey = localDay().slice(0, 7);
    const monthSnapshots = active.snapshots.filter((item) => item.date.startsWith(currentMonthKey)).sort((a, b) => a.date.localeCompare(b.date));
    const snapshotNet = (snapshot: Snapshot) => snapshot.netBalance ?? active.accounts.reduce((sum, account) => sum + (account.type === "credit" ? -(snapshot.balances[account.id] ?? 0) : (snapshot.balances[account.id] ?? 0)), 0);
    const monthDelta = monthSnapshots.length > 1 ? snapshotNet(monthSnapshots.at(-1)!) - snapshotNet(monthSnapshots[0]) : 0;
    const forecast = monthEndForecast(netBalance, now, { ...active, commitments: forecastLoans(source.commitments, now) });
    const totalDebt = active.commitments.reduce((sum, item) => sum + item.balance, 0);
    return { income, netIncome, annualIncome, currentAnnualIncome, fixedCosts, payments, goalNeed, available, unallocated, flexible, burden, bufferMonths, bankBalance, creditBalance, netBalance, monthDelta, forecast, totalDebt };
  }, [active, source, today]);

  const groupedExpenses = useMemo(() => {
    const groups = new Map<string, { category: string; value: number; color: string; expenses: Expense[]; loans: Commitment[] }>();
    function groupFor(label: string) {
      const category = label.toLocaleLowerCase("de") === "kreditraten" ? "Kreditraten" : label;
      const existing = groups.get(category);
      if (existing) return existing;
      const color = active.categoryColors[category] ?? defaultCategoryColors[category] ?? (category === "Kreditraten" ? "#f2b1a5" : "#938178");
      const group = { category, value: 0, color, expenses: [] as Expense[], loans: [] as Commitment[] };
      groups.set(category, group);
      return group;
    }
    for (const item of active.expenses) {
      if (item.frequency === "once") continue;
      const group = groupFor(item.category);
      group.expenses.push(item);
    }
    for (const loan of active.commitments) {
      const payment = monthlyLoanPayment(loan);
      if (!payment) continue;
      const group = groupFor(loan.category?.trim() || "Kreditraten");
      group.loans.push(loan);
    }
    for (const group of groups.values()) group.value = averageMonthlyCosts(group.expenses, group.loans, today);
    return [...groups.values()].sort((a, b) => b.value - a.value || a.category.localeCompare(b.category, "de"));
  }, [active.expenses, active.commitments, active.categoryColors, today]);

  const savingsMetrics = useMemo(() => {
    const items = active.savings.map((item) => ({ ...item, value: (business ? depreciation(item, today)?.book : undefined) ?? savingValue(item) })).sort((a, b) => b.value - a.value);
    const total = items.reduce((sum, item) => sum + item.value, 0);
    const securities = items.filter((item) => item.kind === "security").reduce((sum, item) => sum + item.value, 0);
    const reserves = total - securities;
    const latestQuote = items.filter((item) => item.quoteUpdatedAt).sort((a, b) => (b.quoteUpdatedAt ?? "").localeCompare(a.quoteUpdatedAt ?? ""))[0]?.quoteUpdatedAt;
    return { items, total, securities, reserves, latestQuote };
  }, [active.savings, business, today]);

  function originalPrincipalField(item: Commitment, index: number) {
    return <label>Ursprüngliche Kreditsumme (€ · optional)
      <DecimalInput value={item.originalPrincipal} signed={false} placeholder="z. B. 20.000"
        onValueChange={value => updateList("commitments", index, { originalPrincipal: value > 0 ? value : undefined })} />
    </label>;
  }

  function loanPriorityField(item: Commitment, index: number) {
    return <label>Priorität<select value={item.highPriority ? "high" : "normal"}
      onChange={event => updateList("commitments", index, { highPriority: event.target.value === "high" })}>
      <option value="normal">Normal</option><option value="high">Hoch</option>
    </select></label>;
  }

  function loanCategoryField(item: Commitment, index: number) {
    const options = [...new Set(["Kreditraten", ...categoryOptions])];
    return <label className="loan-category-field">Kategorie
      <select value={item.category?.trim() || "Kreditraten"} onChange={event => updateList("commitments", index, { category: event.target.value })}>
        {options.map(option => <option key={option}>{option}</option>)}
      </select>
    </label>;
  }

  function openEditor() {
    baseline.current = plan;
    setImportPreview(null);
    setImportError("");
    setDraft(structuredClone(orderedPlan(plan ?? emptyPlan())));
    setEditorScope(null);
    setEditorTarget(null);
    setEditing(true);
  }

  function openFocusedEditor(section: EditorScope, add?: "account" | "income" | "expense" | "loan" | "goal" | "security" | "saving", target?: string) {
    if (add && grant && access === "view") return;
    baseline.current = plan;
    const next = structuredClone(orderedPlan(plan ?? emptyPlan()));
    let nextTarget = target ?? null;
    if (add === "account") next.accounts.push({ id: uid(), name: "", type: "bank", balance: 0 });
    if (add === "income") next.incomes.push({ id: uid(), name: "", amount: 0, annual: false, month: undefined });
    if (add === "expense") { const id = uid(); next.expenses.push({ id, name: "", amount: 0, category: target ?? (business ? "Betriebskosten" : "Lebenshaltung"), bookingDay: 0 }); nextTarget = `item:${id}`; }
    if (add === "loan") { const id = uid(); next.commitments.push({ id, name: "", balanceDate: today, balance: 0, payment: 0, interestRate: 0, termMonths: 0, extraPayment: 0 }); nextTarget = id; }
    if (add === "goal") { const id = uid(); next.goals.push({ id, name: "", target: 0, saved: 0, monthly: 0, targetDate: "" }); nextTarget = id; }
    if (add === "security") { const id = uid(); next.savings.push({ id, name: "", kind: "security", balance: 0, symbol: "", quantity: 0, price: 0, priceEur: 0, currency: "EUR" }); nextTarget = id; }
    if (add === "saving") { const id = uid(); next.savings.push({ id, name: "", kind: newSavingKind, balance: 0 }); nextTarget = id; }
    setSavingsOpen(false);
    setDraft(next);
    setEditorScope(section);
    setEditorTarget(nextTarget);
    setEditing(true);
  }

  function forecastButton(row: ForecastRow, dated: boolean) {
    const target = row.section === "expenses" ? "item:" + row.itemId : row.itemId;
    return <button className="detail-row forecast-entry" key={row.id} type="button"
      onClick={() => openFocusedEditor(row.section, undefined, target)}>
      <span>{dated ? `${row.day}. · ` : ""}{row.name}
        {!dated && <small>{row.dueDate ? "Offen · fällig am " + row.dueDate : row.monthUnknown ? "Monat offen" : row.day ? "Heute fällig · im Kontostand eventuell schon enthalten" : "Ohne Buchungstag"}</small>}
      </span>
      <b>{exactEuros.format(row.amount)}</b><span aria-hidden="true"><UiIcon name="next" /></span>
    </button>;
  }

  function closeEditor() {
    setEditing(false);
    setEditorScope(null);
    setEditorTarget(null);
  }

  async function saveDashboardBasis(basis: VatBasis) {
    const copy = current.current;
    if (!copy || savingBasis || copy.session !== currentSession()) return;
    setSavingBasis(true);
    setBasisError("");
    try {
      const response = await fetch("/api/account", {method: "PATCH", headers: {
        "Content-Type": "application/json", "x-njora-browser-session": copy.session
      }, body: JSON.stringify({dashboardBasis: basis}), signal: AbortSignal.timeout(15000)});
      if (!response.ok || (await response.json()).dashboardBasis !== basis) throw new Error();
      if (copy.session !== currentSession()) return;
      setCloudUser(user => user ? {...user, dashboardBasis: basis} : user);
      setComparison(null);
      channel.current?.postMessage("dashboard-preference");
      syncNow.current();
    } catch {
      setBasisError("Die Standardansicht konnte nicht gespeichert werden. Bitte versuche es erneut.");
    } finally { setSavingBasis(false); }
  }

  async function persistPlan(next: Plan, base = plan) {
    if (grant !== null) {
      if(access !== "edit") { setProblem("Du hast Lesezugriff."); return false; }
      try {
        const reply = await sharing<{revision:number}>(space,"plan",{id:grant,plan:storagePlan(next),revision:sharedRevision.current},"PUT");
        sharedRevision.current=reply.revision; setPlan(next); setProblem(""); setSyncStatus("saved"); return true;
      } catch(e) {
        if(e instanceof ShareError && [401,402,403,404,409].includes(e.status)) setSharedFailure(e.message);
        setProblem(e instanceof Error ? e.message : "Speichern fehlgeschlagen."); return false;
      }
    }
    const copy = current.current;
    if (!copy || copy.billing?.active === false) return false;
    setSyncStatus("saving");
    try {
      const result = await updateCopy(copy.user.email, copy.session, saved => {
        if (!saved || saved.session !== copy.session || differentAccount(copy.user, saved.user)) throw new SessionChanged();
        if (saved.billing?.active === false) throw new Error("Für Änderungen brauchst du ein aktives Abo.");
        const merged = mergeDraft(base, next, saved.draft);
        if (!merged) throw new Error("Der Finanzplan fehlt.");
        const payload = storagePlan(merged);
        if (!isPlan(payload)) throw new RangeError("Ein Eintrag überschreitet die zulässige Länge, Anzahl oder einen Wertebereich. Bitte prüfe deine Eingaben.");
        if (new TextEncoder().encode(JSON.stringify(payload)).length > 500_000) {
          throw new RangeError("Der Finanzplan ist zu groß für den Cloud-Abgleich.");
        }
        return {...saved, draft:merged};
      }, false, business);
      if (!result) throw new Error();
      current.current = result;
      setPlan(result.draft);
      channel.current?.postMessage("plan");
      setSyncStatus(clash.current ? "conflict" : "pending");
      setProblem("");
      syncNow.current();
      return true;
    } catch (error) {
      if (error instanceof SessionChanged) { location.reload(); return false; }
      setProblem(error instanceof RangeError ? error.message : error instanceof Conflict ? "Dieser Eintrag wurde während der Bearbeitung geändert. Öffne ihn erneut."
        : "Der Browser konnte die Änderung nicht speichern. Prüfe den verfügbaren Speicher.");
      setSyncStatus("error"); return false;
    }
  }

  async function resolveConflict(choice: Choice) {
    const copy = current.current, remote = clash.current;
    if (!copy || !remote) return;
    try {
      const result = await updateCopy(copy.user.email, copy.session, saved => {
        if (!saved || saved.session !== copy.session || differentAccount(copy.user, saved.user)) throw new SessionChanged();
        return reconcile(saved, remote, choice);
      }, false, business);
      if (result) {
        current.current = result; clash.current = null; setPlan(result.draft); setProblem("");
        setSyncStatus("pending"); syncNow.current();
      }
    } catch { setProblem("Die Auswahl konnte nicht gespeichert werden."); }
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim()) { setProblem("Bitte gib deinem Finanzplan einen Namen."); setSyncStatus("error"); return; }
    if (draft.flexibleCosts.some(item => !item.name.trim() || item.amount < 0 || Number(item.amount.toFixed(2)) !== item.amount)) {
      setProblem("Bitte gib für jeden flexiblen Kostenposten eine Bezeichnung und einen Monatsbetrag ab 0 € mit höchstens zwei Nachkommastellen ein.");
      setSyncStatus("error"); return;
    }
    if (draft.savings.some(asset => !validDepreciation(asset))) {
      setProblem("Bitte prüfe Anschaffungskosten, Startmonat und Nutzungsdauer. Der Restwert darf die Anschaffungskosten nicht übersteigen.");
      setSyncStatus("error");
      return;
    }
    const clean = normalizePlan({ ...draft, name: draft.name.trim(), savings: draft.savings.map((item) => ({ ...item, name: item.name.trim(), symbol: item.kind === "security" ? item.symbol?.trim().toUpperCase() : undefined })) });
    if (await persistPlan(clean, baseline.current)) {
      setEditing(false);
      setEditorScope(null);
      setEditorTarget(null);
    }
  }

  function onboardingIssue(step: number) {
    if (step === 0 && !draft.name.trim()) return "Bitte gib deinem Finanzplan einen Namen.";
    if (step === 1 && !draft.accounts.some((item) => item.name.trim())) return "Bitte lege mindestens ein Konto oder eine Karte an.";
    if (step === 2 && !business && !draft.incomes.some((item) => !item.annual && item.name.trim() && item.amount > 0)) return "Bitte trage mindestens ein monatliches Einkommen mit Betrag ein.";
    if (step === 3 && draft.expenses.some((item) => item.amount > 0 && !item.name.trim())) return "Bitte ergänze zu jedem eingetragenen Betrag eine Bezeichnung.";
    if (step === 4 && draft.commitments.some((item) => !item.name.trim() || item.balance <= 0 || item.payment <= 0)) return "Bitte vervollständige angelegte Kredite mit Name, Restschuld und Monatsrate.";
    if (step === 5 && draft.goals.some((item) => !item.name.trim() || item.target <= 0)) return "Bitte vervollständige angelegte Ziele mit Name und Zielbetrag.";
    return "";
  }

  function nextOnboardingStep() {
    const issue = onboardingIssue(onboardingStep);
    if (issue) {
      setOnboardingError(issue);
      return;
    }
    setOnboardingError("");
    setOnboardingStep((current) => Math.min(current + 1, onboardingSteps.length - 1));
  }

  function previousOnboardingStep() {
    setOnboardingError("");
    setOnboardingStep((current) => Math.max(current - 1, 0));
  }

  async function finishOnboarding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    if (onboardingStep < onboardingSteps.length - 1) {
      nextOnboardingStep();
      return;
    }
    for (let step = 0; step < onboardingSteps.length; step += 1) {
      const issue = onboardingIssue(step);
      if (issue) {
        setOnboardingStep(step);
        setOnboardingError(issue);
        return;
      }
    }
    const clean = normalizePlan({
      ...draft,
      name: draft.name.trim(),
      accounts: draft.accounts.filter((item) => item.name.trim()).map((item) => ({ ...item, name: item.name.trim() })),
      incomes: draft.incomes.filter((item) => item.name.trim() && item.amount > 0).map((item) => ({ ...item, name: item.name.trim() })),
      expenses: draft.expenses.filter((item) => item.name.trim() && item.amount > 0).map((item) => ({ ...item, name: item.name.trim() })),
      annualCosts: draft.annualCosts.filter((item) => item.name.trim() && item.amount > 0).map((item) => ({ ...item, name: item.name.trim() })),
      commitments: draft.commitments.filter((item) => item.name.trim() && item.balance > 0 && item.payment > 0).map((item) => ({ ...item, name: item.name.trim() })),
      goals: draft.goals.filter((item) => item.name.trim() && item.target > 0).map((item) => ({ ...item, name: item.name.trim() })),
    });
    if (!await persistPlan(clean)) setOnboardingError("Dein Finanzplan konnte gerade nicht gespeichert werden. Bitte versuche es erneut.");
  }

  function selectCheckInDate(date: string, source = baseline.current) {
    if (!source) return;
    const fields = checkInFields(source, date, localDay());
    setCheckInDate(date);
    setCheckInAccounts(fields.accounts);
    setCheckInNote(fields.note);
  }

  const revenueMonth = previousRevenueMonth(checkInDate);
  const checkInRevenue = revenueDrafts[revenueMonth] ?? revenueDraft(baseline.current ?? {}, revenueMonth);
  const revenueAmount = revenueAmounts(checkInRevenue);
  const dashboardRevenueMonth = previousRevenueMonth(today);

  function openCheckIn() {
    if (grant && access === "view") return;
    if (!plan) return;
    baseline.current = plan;
    setRevenueDrafts({});
    selectCheckInDate(localDay(), plan);
    setCheckingIn(true);
  }

  async function saveCheckIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const initial = baseline.current;
    if (!initial || !checkInDate || checkInDate > localDay()) return;
    if (business && (!revenueMonth || revenueAmount === null)) return;
    const accounts = checkInAccounts.map(account => ({ ...account, name: account.name.trim() || "Unbenanntes Konto" }));
    const snapshot = checkInRecord(initial, checkInDate, localDay(), accounts, checkInNote, uid());
    const updated: Plan = {
      ...(business && revenueAmount ? withRevenue(initial, revenueMonth, revenueAmount) : initial),
      accounts: checkInDate === localDay() ? accounts : initial.accounts,
      snapshots: [...initial.snapshots.filter((item) => item.date !== snapshot.date), snapshot].sort((a, b) => a.date.localeCompare(b.date)),
    };
    if (await persistPlan(updated, initial)) setCheckingIn(false);
  }

  function previewImport() {
    setImportError("");
    setImportPreview(null);
    try {
      if (new TextEncoder().encode(importText).byteLength > 4_000_000) {
        setImportError("Die Sicherung überschreitet die maximale Dateigröße von 4 MB.");
        return;
      }
      const data = backupPlan(JSON.parse(importText));
      if (!data) throw new Error();
      if (new TextEncoder().encode(JSON.stringify(data)).byteLength > 500_000) {
        setImportError("Der Finanzplan ist zu groß für den Cloud-Abgleich.");
        return;
      }
      setImportPreview(normalizePlan(data as Partial<Plan>));
    } catch {
      setImportError("Diese Datei enthält keine vollständige Njora-Plansicherung.");
    }
  }

  async function confirmImport() {
    if (!importPreview || !await persistPlan(importPreview)) return;
    setEditing(false);
    setEditorScope(null);
    setEditorTarget(null);
    setImportText("");
    setImportPreview(null);
  }

  async function importLegacyPlan() {
    if (!legacyPlan) return;
    if (await persistPlan(legacyPlan, null)) {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(PREVIOUS_STORAGE_KEY);
      window.localStorage.removeItem(OLD_STORAGE_KEY);
      setLegacyPlan(null);
      setShowLegacyPrompt(false);
    }
  }

  async function exportPlan() {
    if (!plan) return;
    const backup = JSON.stringify(storagePlan(plan));
    const filename = `njora-sicherung-${localDay()}.json`;
    if (Capacitor.isNativePlatform()) {
      try {
        const { Share } = await import("@capacitor/share");
        await Share.share({ title: filename, text: backup, dialogTitle: "Njora-Sicherung teilen" });
        return;
      } catch {
        // Fall back to the browser download if the native share sheet is unavailable.
      }
    }
    const blob = new Blob([backup], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function deleteAccount() {
    const copy = current.current;
    if (deleteConfirmation !== "LÖSCHEN" || deletingAccount || !copy) return;
    let failure = "Die Löschung konnte nicht bestätigt werden. Bitte prüfe deine Verbindung und versuche es erneut.";
    setDeletingAccount(true);
    try {
      const response = await fetch("/api/account", { method: "DELETE", headers: {"x-njora-browser-session":copy.session} });
      if (!response.ok) {
        const issue = await response.json().catch(() => null);
        if (issue?.code === "billing_cancellation_unconfirmed" && typeof issue.error === "string") failure = issue.error;
        throw new Error("delete failed");
      }
      await updateCopy(copy.user.email, copy.session, () => undefined, true, business);
      await updateCopy(copy.user.email, copy.session, () => undefined, true, !business);
      channel.current?.postMessage("session");
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(PREVIOUS_STORAGE_KEY);
      window.localStorage.removeItem(OLD_STORAGE_KEY);
      window.location.href = cloudUser?.local ? "/" : "/login";
    } catch {
      setProblem(failure);
      setSyncStatus("error");
      setDeletingAccount(false);
    }
  }

  async function signOut() {
    const copy = current.current;
    if (!copy) return;
    try {
      const stored = await offlineCopy(copy.session, business);
      const other = await offlineCopy(copy.session, !business);
      if ((stored && pending(stored)) || (other && pending(other))) {
        setProblem("Bitte gleiche offene Änderungen in beiden Bereichen vor dem Abmelden ab."); syncNow.current(); return;
      }
      const response = await fetch("/api/auth/logout", {method:"POST", headers:{"x-njora-browser-session":copy.session}});
      if (!response.ok) throw new Error();
      await updateCopy(copy.user.email, copy.session, saved => saved && (saved.session !== copy.session || pending(saved)) ? saved : undefined, true, business);
      await updateCopy(copy.user.email, copy.session, saved => saved && (saved.session !== copy.session || pending(saved)) ? saved : undefined, true, !business);
      channel.current?.postMessage("session");
      location.replace("/login");
    } catch { setProblem("Abmelden ist fehlgeschlagen. Bitte prüfe die Verbindung."); }
  }

  function openSavings() {
    setSavingsOpen(true);
  }

  function updateList<T extends keyof Pick<Plan, "flexibleCosts" | "incomes" | "expenses" | "annualCosts" | "commitments" | "goals" | "savings" | "accounts">>(key: T, index: number, patch: Partial<Plan[T][number]>) {
    setDraft((current) => ({
      ...current,
      [key]: current[key].map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  }

  function removeListItem(key: keyof Pick<Plan, "flexibleCosts" | "incomes" | "expenses" | "annualCosts" | "commitments" | "goals" | "savings" | "accounts">, index: number) {
    setDraft((current) => ({ ...current, [key]: current[key].filter((_, itemIndex) => itemIndex !== index) }));
  }

  if (!ready) return <main className="loading" aria-label="Njora wird geladen"><span className="loading-mark" /></main>;
  if (grant !== null && sharedFailure) return <main className="legal-page"><article><h1>Geteilter Finanzbereich</h1><p>{sharedFailure}</p><a href={sharePath}>Freigaben öffnen</a></article></main>;
  if (authStatus === "anonymous") return <main className="loading" aria-label="Weiterleitung zur Anmeldung" />;
  if (authStatus === "unavailable") return <main className="auth-shell"><section className="auth-card"><Brand /><p className="eyebrow">Kurz nicht erreichbar</p><h1>{isLocalMode ? "Lokale Version wird vorbereitet." : "Deine Daten bleiben sicher."}</h1><p>{isLocalMode ? "Die lokale Datenbank konnte gerade nicht erreicht werden. Eine Anmeldung ist für localhost nicht erforderlich." : "Njora konnte die persönliche Cloud gerade nicht erreichen. Bitte versuche es in einem Moment erneut."}</p><button className="auth-button" type="button" onClick={() => window.location.reload()}>Erneut versuchen <b><UiIcon name="retry" /></b></button></section></main>;

  const currentMonth = new Date().getMonth();
  const lastSnapshot = active.snapshots.filter(item => validCalendarDay(item.date)).sort((a, b) => b.date.localeCompare(a.date))[0];
  const daysSinceUpdate = lastSnapshot ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(lastSnapshot.date)) / 86400000)) : null;
  const lastUpdateLabel = lastSnapshot ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${lastSnapshot.date}T12:00:00`)) : "Noch kein Update";
  const updateDue = daysSinceUpdate === null || daysSinceUpdate >= (active.checkInCadence === "daily" ? 1 : 7);
  const currentMonthName = new Intl.DateTimeFormat("de-DE", { month: "long" }).format(new Date());
  const useNet = business && comparison === "net";
  const basisLabel = useNet ? "Netto" : "Brutto";
  const compareAmount = (gross: number, rate = 0) => useNet ? netFromGross(gross, rate) : gross;
  const income = useNet ? metrics.netIncome : metrics.income;
  const annualIncome = active.incomes.filter(row => row.annual).reduce((total, row) => total + compareAmount(row.amount, row.vatRate), 0);
  const incomeThisMonth = income + active.incomes.filter(row => row.annual && row.month === currentMonth).reduce((total, row) => total + compareAmount(row.amount, row.vatRate), 0);
  const netFixed = business ? averageMonthlyCosts(active.expenses, active.commitments, today, "net") : metrics.fixedCosts;
  const netFlexible = business ? flexibleMonthlyBudget(active.flexibleCosts, "net") : metrics.flexible;
  const fixed = useNet ? netFixed : metrics.fixedCosts;
  const flexible = useNet ? netFlexible : metrics.flexible;
  const surplus = income - fixed - flexible;
  const dashboardRevenue = revenueValue(active, dashboardRevenueMonth, comparison);
  const basisPicker = business && <label className="comparison-basis">Vergleichswerte<select value={comparison} onChange={e => setComparison(e.target.value === "net" ? "net" : "gross")}><option value="gross">Brutto</option><option value="net">Netto</option></select></label>;
  const currentSpecials = [
    ...active.incomes.filter((item) => item.annual && item.month === currentMonth).map((item) => ({ id: `income-${item.id}`, name: item.name, amount: compareAmount(item.amount, item.vatRate), type: "income" as const })),
    ...active.expenses.filter((item) => item.frequency && item.frequency !== "monthly" && isExpenseDue(item, currentMonth)).map((item) => ({ id: `cost-${item.id}`, name: item.name, amount: compareAmount(expenseAmount(item, today), item.vatRate), type: "cost" as const })),
  ];
  const monthOutflows = groupedExpenses.map(({ category: label, value, color, expenses, loans }) => ({ label, value: useNet ? averageMonthlyCosts(expenses, loans, today, "net") : value, color, alternate: business ? (useNet ? value : averageMonthlyCosts(expenses, loans, today, "net")) : undefined }));
  monthOutflows.sort((a, b) => b.value - a.value);
  const selectedCostGroup = groupedExpenses.find(group => group.category === costDetail.category);
  const costItems = costDetail.category ? selectedCostGroup?.expenses ?? [] : active.expenses;
  const costLoans = (costDetail.category ? selectedCostGroup?.loans ?? [] : active.commitments)
    .filter(loan => monthlyLoanPayment(loan) > 0)
    .sort((a, b) => monthlyLoanPayment(b) - monthlyLoanPayment(a) || a.name.localeCompare(b.name, "de"));

  const pastCheckIn = checkingIn && checkInDate < today;
  const previousCheckIn = checkingIn && baseline.current?.snapshots.find(entry => entry.date === checkInDate);
  const checkInTotal = checkingIn && baseline.current
    ? checkInRecord(baseline.current, checkInDate, today, checkInAccounts, checkInNote, "").netBalance ?? 0
    : 0;

  const editorCopy: Record<EditorScope, { eyebrow: string; title: string; intro: string }> = {
    accounts: { eyebrow: "Konten & Karten", title: "Konten bearbeiten", intro: "Passe ausschließlich deine Konten und Karten an. Aktuelle Stände pflegst du weiterhin am schnellsten über den Check-in." },
    income: { eyebrow: "Einkommen", title: "Einkommen bearbeiten", intro: "Pflege hier ausschließlich deine monatlichen und jährlichen Einkommensquellen. Jahreszuflüsse erscheinen nur in ihrem hinterlegten Monat." },
    flexible: { eyebrow: "Monatsplan", title: "Flexible Kosten", intro: "Plane jeden Monat einen Betrag für Ausgaben ohne festen Buchungstag." },
    expenses: { eyebrow: "Monatsplan", title: "Fixkosten bearbeiten", intro: "Wähle Betrag, Kategorie und Zahlungsrhythmus deiner Fixkosten." },
    specials: { eyebrow: "Sonderposten", title: "Unregelmäßig, aber planbar", intro: "Pflege jährliche Einnahmen und Ausgaben mit ihrem jeweiligen Monat. So weißt du frühzeitig, was besonders wird." },
    loans: { eyebrow: "Verbindlichkeiten", title: "Kredite bearbeiten", intro: "Passe Restschuld und Rate an oder ergänze optionale Vertragsdetails für eine genauere Prognose." },
    goals: { eyebrow: "Ziele", title: "Ziele bearbeiten", intro: "Lege Zielbetrag, aktuellen Stand und optional ein Zieldatum fest. Eine notwendige Sparrate wird nur für Terminziele berechnet." },
    savings: { eyebrow: business ? "Unternehmen" : "Vermögen & Depot", title: business ? "Vermögenswerte bearbeiten" : "Ersparnisse bearbeiten", intro: "Führe Wertpapiere mit Stückzahl und Börsensymbol oder andere Sparformen mit ihrem aktuellen Stand." },
  };
  let currentEditorCopy = editorScope ? editorCopy[editorScope] : null;
  if (editorScope === "income" && editorTarget) {
    const item = draft.incomes.find(income => income.id === editorTarget);
    currentEditorCopy = { eyebrow: "Einkommen", title: item?.name || "Einkommen bearbeiten", intro: "Betrag, Rhythmus und Buchungstag dieser Einnahme." };
  }
  if (editorScope === "expenses" && editorTarget) {
    if (editorTarget.startsWith("item:")) {
      const item = draft.expenses.find(expense => expense.id === editorTarget.slice(5));
      currentEditorCopy = { eyebrow: "Fixkosten", title: item?.name || "Neue Ausgabe anlegen", intro: "Betrag, Kategorie und Fälligkeit dieser Ausgabe." };
    } else {
      currentEditorCopy = { eyebrow: "Fixkosten", title: `${editorTarget} bearbeiten`, intro: `Hier siehst und änderst du ausschließlich die Einträge aus der Kategorie ${editorTarget}.` };
    }
  }
  if (editorScope === "loans" && editorTarget) {
    const loan = draft.commitments.find((item) => item.id === editorTarget);
    if (loan) currentEditorCopy = { eyebrow: "Kredit", title: loan.name || "Neuen Kredit anlegen", intro: "Bearbeite ausschließlich diesen Kredit und ergänze bei Bedarf Vertragsdetails für die Prognose." };
  }
  if (editorScope === "goals" && editorTarget) {
    const goal = draft.goals.find((item) => item.id === editorTarget);
    currentEditorCopy = { eyebrow: "Ziel", title: goal?.name || "Neues Ziel anlegen", intro: "Lege einen Zielbetrag fest. Erst ein optionales Zieldatum erzeugt daraus einen rechnerischen monatlichen Bedarf." };
  }
  if (editorScope === "savings" && editorTarget) {
    const saving = draft.savings.find((item) => item.id === editorTarget);
    currentEditorCopy = { eyebrow: saving?.kind === "security" ? "Wertpapier" : business ? "Vermögenswert" : "Ersparnis", title: saving?.name || (saving?.kind === "security" ? "Wertpapier hinzufügen" : business ? "Vermögenswert hinzufügen" : "Sparform hinzufügen"), intro: saving?.kind === "security" ? "Mit der ISIN übernimmt Njora den verfügbaren Euro-Schlusskurs von Cboe Europe. Ohne ISIN kannst du den Kurs selbst eintragen." : business ? "Erfasse den Wert und plane bei Bedarf eine lineare Abschreibung." : "Trage den aktuellen Stand dieser Sparform ein. Sie bleibt getrennt von deinem laufenden Kontostand." };
  }

  function showCosts(from: "home" | "month", category?: string) {
    setCostDetail({ from, category });
    navigate("expenses");
  }

  function navigate(view: View) {
    if (grant && view === "more") { location.assign(sharePath); return; }
    setActiveView(view);
    window.scrollTo({ top: 0 });
  }

  const syncLabel = {idle:"", saving:"Wird auf diesem Gerät gespeichert …", saved:"Mit der Cloud abgeglichen",
    pending:"Lokal gespeichert · Cloud-Abgleich ausstehend", offline:"Offline · Letzter gespeicherter Stand",
    conflict:"Versionskonflikt beim Cloud-Abgleich", error:"Änderung konnte nicht gespeichert werden"}[syncStatus];
  const saveNotice = (problem || syncStatus === "conflict" || syncStatus === "pending" || syncStatus === "offline") && (
    <div className="save-notice" role="status">
      <span>{problem || syncLabel}</span>
      {syncStatus === "conflict" ? <>
        <span>Unabhängige Änderungen bleiben erhalten. Welche Werte sollen bei Überschneidungen gelten?</span>
        <button type="button" onClick={() => resolveConflict("device")}>Meine Werte behalten</button>
        <button type="button" onClick={() => resolveConflict("cloud")}>Cloud-Werte behalten</button>
      </> : <button type="button" onClick={() => syncNow.current()}>Erneut abgleichen</button>}
    </div>
  );

  if (billing && !billing.active && activeView !== "more") return (
    <main className="legal-page"><article>
      {workspacePicker}<BillingOffer workspace={space} billing={billing} standalone /><a href={sharePath}>Einladungen und geteilte Bereiche</a>
      <button type="button" className="text-action" onClick={() => navigate("more")}>Konto, Datenexport und Löschung</button>
      <LegalLinks />
    </article></main>
  );
  const savingsOverview = (
    <button className="savings-overview-card" type="button" onClick={openSavings} aria-label={business ? "Vermögenswerte öffnen" : "Depot und Ersparnisse öffnen"}>
      <div className="savings-overview-head"><div>{!business && <p className="eyebrow">Vermögen & Depot</p>}<h2>{savingsTitle}</h2></div><TitleAmount value={savingsMetrics.total} label="Gesamtwert" /></div>
      {savingsMetrics.total > 0 ? <><div className="savings-split" aria-label={"Aufteilung · " + savingsTitle}><i style={{ width: `${(savingsMetrics.securities / savingsMetrics.total) * 100}%` }} /><i style={{ width: `${(savingsMetrics.reserves / savingsMetrics.total) * 100}%` }} /></div><div className="savings-overview-meta"><span><i />Wertpapiere {euro(savingsMetrics.securities)}</span><span><i />{business ? "Weitere Vermögenswerte" : "Weitere Rücklagen"} {euro(savingsMetrics.reserves)}</span></div></> : <p>{business ? "Ersten Vermögenswert hinzufügen" : "Noch keine Ersparnisse hinterlegt · jetzt Depot oder Sparform hinzufügen"}</p>}
      <small>{savingsMetrics.latestQuote ? `Letzter Datenstand ${dateTimeLabel(savingsMetrics.latestQuote)}` : business ? "Buchwerte zum Monatsende" : "Aktien und ETFs per ISIN mit Schlusskurs bewerten"}</small>
    </button>
  );
  return (
    <main id="top" className="page-shell" data-appearance={appearance.appearance}>
      <header className="topbar">
        <div className="workspace-brand">{workspacePicker}<button className="brand" type="button" onClick={() => navigate("home")} aria-label="Njora Startseite"><Brand /></button></div>
        <nav className="desktop-nav" aria-label="Hauptnavigation">
          <NavButton active={activeView === "home"} onClick={() => navigate("home")}>Heute</NavButton>
          {business && <NavButton active={activeView === "revenue"} onClick={() => navigate("revenue")}>Umsatz</NavButton>}
          <NavButton active={activeView === "month"} onClick={() => navigate("month")}>Monatsplan</NavButton>
          <NavButton active={activeView === "loans"} onClick={() => navigate("loans")}>Kredite</NavButton>
          {!business && <NavButton active={activeView === "goals"} onClick={() => navigate("goals")}>Ziele</NavButton>}
          <NavButton active={activeView === "more"} onClick={() => navigate("more")}>Mehr</NavButton>
        </nav>
        <button className="profile-button" type="button" onClick={() => navigate("more")} aria-label={active.name + " – Konto und Einstellungen"}><span aria-hidden="true"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" focusable="false"><circle cx="12" cy="8" r="3.3" /><path d="M4.7 20a7.3 7.3 0 0 1 14.6 0" /></svg></span><b>{active.name}</b></button>
      </header>

      {grant && <p className="share-indicator">Geteilter Bereich · {access === "view" ? "Nur ansehen" : "Mitbearbeiten"}</p>}
      {!editing && !checkingIn && !savingsOpen && (plan || billing?.active === false) && saveNotice}

      <div className="app-content">
        {activeView === "home" && <section className="view home-view" aria-labelledby="home-title">
          <div className="mobile-greeting"><div><p className="eyebrow">{currentMonthName}</p><h1 id="home-title">{business ? active.name : "Heute"}</h1></div><button type="button" className="dashboard-account-link" title={updateDue ? "Check-in fällig · Kontostände aktualisieren" : "Kontostände aktualisieren"} onClick={openCheckIn}><TitleAmount value={metrics.netBalance} label="Kontostand bearbeiten" /></button></div>
          <div className="njora-columns"><div className="njora-column">
          <button type="button" className="dashboard-balance" aria-expanded={showForecast} aria-controls="forecast-detail" onClick={() => setShowForecast(!showForecast)}>
            <span>Prognose zum Monatsende</span>
            <strong>≈ {exactEuros.format(metrics.forecast.projectedBalance)}</strong>
            <span>{metrics.flexible ? "Mit Zahlungen und anteiligem Monatsbudget" : "Mit datierten Zahlungen"}{metrics.forecast.uncertain.length > 0 ? ` · ${metrics.forecast.uncertain.length} ${metrics.forecast.uncertain.length === 1 ? "Buchung" : "Buchungen"} offen` : ""}</span>
          </button>
          {basisPicker}
          <div className="dashboard-metrics">
            {business && <button type="button" onClick={() => navigate("revenue")}><span>{basisLabel}umsatz {revenueMonthLabel(dashboardRevenueMonth)}</span><strong>{dashboardRevenue !== undefined ? exactEuros.format(dashboardRevenue) : active.monthlyRevenue?.[dashboardRevenueMonth] === undefined ? "Umsatz erfassen" : "Steuerangabe fehlt"}</strong></button>}
            <button type="button" onClick={() => openFocusedEditor("income")}><span>{business ? "Betriebseinnahmen " + basisLabel.toLowerCase() : "Einkommen"} im {currentMonthName}</span><strong>{exactEuros.format(incomeThisMonth)}</strong></button>
            <button type="button" onClick={() => showCosts("home")}><span>{business ? "Betriebskosten " + basisLabel.toLowerCase() : "Fixkosten"} · Ø pro Monat</span><strong>{exactEuros.format(fixed)}</strong></button>
            <button type="button" onClick={() => openFocusedEditor("flexible")}><span>Flexible Kosten · pro Monat</span><strong>{exactEuros.format(flexible)}</strong></button>
            <button type="button" onClick={() => navigate("month")}><span>{business ? "Monatlicher Überschuss" : "Monatlicher Spielraum"}</span><strong>{exactEuros.format(surplus)}</strong></button>
            <button type="button" onClick={() => navigate("loans")}><span>Offene Kreditschuld</span><strong>{exactEuros.format(metrics.totalDebt)}</strong></button>
          </div>
          {showForecast && <section id="forecast-detail" className="detail-card">
            <h2>Monatsendprognose</h2>
            <h3>{business ? "Zahlungsbeträge ab heute · brutto" : "Rechnung ab heute"}</h3>
            <button type="button" className="detail-row forecast-entry" onClick={openCheckIn}><span>Kontoguthaben gesamt</span><b>{exactEuros.format(metrics.forecast.positiveBalance)}</b><span aria-hidden="true"><UiIcon name="next" /></span></button>
            {metrics.forecast.overdrafts < 0 && <button type="button" className="detail-row forecast-entry" onClick={openCheckIn}>
              <span>Überzogene Konten</span><b>{exactEuros.format(metrics.forecast.overdrafts)}</b><span aria-hidden="true"><UiIcon name="next" /></span>
            </button>}
            {metrics.forecast.rowsFromToday.map(entry => {
              if (entry.kind === "payment") return forecastButton(entry.row, true);
              const { account, date } = entry;
              return <button type="button" className="detail-row forecast-entry" key={`accounts:${account.id}`} onClick={() => openFocusedEditor("accounts", undefined, account.id)}>
                <span>{date && date.toLocaleDateString("de-DE", { day: "numeric", month: "short" }) + " · "}Kartenausgleich {account.name}
                  {entry.reserved && <small>{date ? "Für nächsten Monat zurückgelegt" : "Zurückgelegt · Buchungstag offen"}</small>}
                </span>
                <b>{exactEuros.format(-account.balance)}</b><span aria-hidden="true"><UiIcon name="next" /></span>
              </button>;
            })}
            <div className="forecast-results">
              {metrics.flexible > 0 && <>
                <div className="forecast-result"><span>Zwischenstand<small>{metrics.forecast.hasCardReserve ? "Nach Zahlungen und Kartenrücklagen" : "Nach datierten Zahlungen"}</small></span><strong>{exactEuros.format(metrics.forecast.datedBalance)}</strong></div>
                <button type="button" className="forecast-result" onClick={() => openFocusedEditor("flexible")}><span>Flexible Kosten<small>Anteilig ab heute bis Monatsende</small></span><strong>{exactEuros.format(-metrics.forecast.remainingBudget)}</strong><UiIcon name="next" /></button>
              </>}
              <div className="forecast-result forecast-total"><span>Prognose zum Monatsende</span><strong>{exactEuros.format(metrics.forecast.projectedBalance)}</strong></div>
            </div>
            {metrics.forecast.uncertain.length > 0 && <>
              <h3>Buchungsstatus unklar</h3>
              {metrics.forecast.uncertain.map(row => forecastButton(row, false))}
              <p><strong>Möglicher Stand am Monatsende</strong><br />{exactEuros.format(metrics.forecast.low)} bis {exactEuros.format(metrics.forecast.high)}</p>
              <p>Unten sind alle offenen Ausgaben berücksichtigt, oben alle offenen Einnahmen.</p>
            </>}
            <p>Die Rechnung setzt einen aktuellen Kontostand voraus. Frühere Fälligkeiten gelten als gebucht. Spätere zählen vollständig. Ungeplante Ausgaben sind offen.</p>
            <small>Letzter Check-in · {lastUpdateLabel}</small>
          </section>}
          </div><div className="njora-column">
          {plan && <BalanceHistory plan={plan} />}
          <div className="dashboard-specials">
            <button className="month-pulse month-specials" type="button" onClick={() => openFocusedEditor("specials")} title="Sonderposten anzeigen und bearbeiten"><span>Besonders im {currentMonthName}</span>{currentSpecials.length ? <div className="specials-preview">{currentSpecials.slice(0, 2).map((item) => <div key={item.id}><b className={item.type === "income" ? "positive" : "negative"}>{item.type === "income" ? "+ " : "− "}{euro(item.amount)}</b><small>{item.name}</small></div>)}</div> : <strong className="specials-empty-label">Keine Sonderposten</strong>}<p>{currentSpecials.length > 2 ? `+ ${currentSpecials.length - 2} weitere · ` : ""}Ansehen und planen <UiIcon name="forward" /></p></button>
          </div>
          <details className="dashboard-income"><summary>Einkommen im Detail</summary><article className="income-home-card"><div className="section-title compact"><div><p className="eyebrow">Einkommen</p><h2>Deine Zuflüsse</h2></div><div className="heading-actions"><TitleAmount value={incomeThisMonth} label={`im ${currentMonthName}`} /><button className="edit-chip" type="button" onClick={() => openFocusedEditor("income")}>Ändern</button></div></div><div className="income-group"><div className="income-group-head"><span>Monatlich</span><strong>{euro(income)}</strong></div>{active.incomes.filter((item) => !item.annual).map((item) => <div className="income-line" key={item.id}><div><strong>{item.name}</strong><small>regelmäßiger Monatszufluss</small></div><b>{business ? exactEuros.format(compareAmount(item.amount, item.vatRate)) : euro(item.amount)}{business && <small>{basisLabel.toLowerCase()} · {exactEuros.format(useNet ? item.amount : netFromGross(item.amount, item.vatRate ?? 0))} {useNet ? "brutto" : "netto"}</small>}</b></div>)}</div><div className="income-group annual"><div className="income-group-head"><span>Jährlich</span><strong>{euro(annualIncome)}</strong></div>{active.incomes.filter((item) => item.annual).map((item) => <div className="income-line" key={item.id}><div><strong>{item.name}</strong><small>jährlicher Sonderzufluss</small></div><b>{business ? exactEuros.format(compareAmount(item.amount, item.vatRate)) : euro(item.amount)}{business && <small>{basisLabel.toLowerCase()} · {exactEuros.format(useNet ? item.amount : netFromGross(item.amount, item.vatRate ?? 0))} {useNet ? "brutto" : "netto"}</small>}<small>{item.month === undefined ? "Monat noch festlegen" : `im ${months[item.month]}`}</small></b></div>)}</div></article></details>
          </div></div>
        </section>}

        {business && activeView === "revenue" && plan && <>{basisPicker}<RevenueHistory basis={comparison} readOnly={!!grant && access === "view"} plan={plan} today={today} save={persistPlan} problem={problem} /></>}
        {activeView === "month" && <section className="view" aria-labelledby="month-title">
          <ViewHeader id="month-title" eyebrow={`Plan für ${currentMonthName}`} title="Monatsplan" total={{ value: surplus, label: business ? "Saldo " + basisLabel.toLowerCase() + " pro Monat" : "Spielraum pro Monat" }} copy="Laufende Kosten, Kreditraten und Rücklagen – in Summe und anteilig." />
          {basisPicker}
          <div className="njora-columns month-columns"><div className="summary-grid"><SummaryCard label={business ? "Betriebseinnahmen " + basisLabel.toLowerCase() : "Monatliches Einkommen"} value={income} alternate={business ? {value: useNet ? metrics.income : metrics.netIncome, label: useNet ? "brutto" : "netto"} : undefined} onClick={() => openFocusedEditor("income")} /><SummaryCard label={business ? "Betriebskosten " + basisLabel.toLowerCase() : "Fixkosten"} value={fixed} alternate={business ? {value: useNet ? metrics.fixedCosts : netFixed, label: useNet ? "brutto" : "netto"} : undefined} tone="coral" onClick={() => showCosts("month")} /><SummaryCard label={business ? "Flexible Kosten " + basisLabel.toLowerCase() : "Flexible Kosten"} alternate={business ? {value: useNet ? metrics.flexible : netFlexible, label: useNet ? "brutto" : "netto"} : undefined} value={flexible} onClick={() => openFocusedEditor("flexible")} /></div>
          <article className="detail-card flow-detail">
            <div className="section-title compact"><div><h2>Durchschnittliche Kosten je Kategorie</h2><small>{income > 0 ? (business ? "Anteil an den regelmäßigen " + basisLabel + "einnahmen" : "Anteil am regelmäßigen Monatseinkommen") : "Für Prozentanteile ein regelmäßiges Einkommen eintragen."}</small></div><div className="plan-position"><strong className={surplus >= 0 ? "positive" : "negative"}>{surplus >= 0 ? "+ " : "− "}{euro(Math.abs(surplus))}</strong>{income > 0 && <span>{incomePercent.format((fixed + flexible) / income)} verplant</span>}</div></div>
            {income > 0 && <div className="stacked-bar" aria-label="Monatseinkommen für geplante Ausgaben">{monthOutflows.map((item) => <i style={{ width: `${item.value / income * 100}%`, backgroundColor: item.color }} key={item.label} />)}{flexible > 0 && <i title="Flexible Kosten" style={{ width: `${flexible / income * 100}%`, backgroundColor: "var(--ink)" }} />}</div>}
            <div className="flow-list">{monthOutflows.map((item) => {
              const share = income > 0 ? item.value / income : null;
              return <button type="button" className="flow-item month-link" onClick={() => showCosts("month", item.label)} key={item.label}><i style={{ backgroundColor: item.color }} /><div><strong>{item.label}</strong><span><em style={{ width: `${Math.min(1, Math.max(0, share ?? 0)) * 100}%`, backgroundColor: item.color }} /></span></div><b>{exactEuros.format(item.value)}{item.alternate !== undefined && <small>{basisLabel.toLowerCase()} · {exactEuros.format(item.alternate)} {useNet ? "brutto" : "netto"}</small>}{share !== null && <small>{incomePercent.format(share)}</small>}</b><span aria-hidden="true"><UiIcon name="next" /></span></button>;
            })}</div>
          </article>
          </div>
        </section>}

        {activeView === "expenses" && <section className="view" aria-labelledby="expenses-title">
          <button type="button" className="edit-chip" onClick={() => navigate(costDetail.from)}><UiIcon name="back" /> {costDetail.from === "month" ? "Monatsplan" : "Heute"}</button>
          <div className="section-title financial-heading"><h2 id="expenses-title">{costDetail.category ?? "Fixkosten"}</h2><TitleAmount value={costDetail.category ? averageMonthlyCosts(costItems, costLoans, today, useNet ? "net" : "gross") : fixed} label={business ? basisLabel + " · Ø pro Monat" : "Ø pro Monat"} /></div>
          {basisPicker}
          <div className="category-details">
            {costLoans.length > 0 && <article className="detail-card category-card">
              <h3>Kredite</h3>
              {costLoans.map(loan => <button className="detail-row forecast-entry" type="button" key={loan.id} onClick={() => openFocusedEditor("loans", undefined, loan.id)}>
                <span>{loan.name}<small>{loan.category || "Kreditraten"} · Monatsrate{loan.bookingDay ? ` · am ${loan.bookingDay}.` : ""}</small></span>
                <b>{exactEuros.format(monthlyLoanPayment(loan))}</b><span aria-hidden="true"><UiIcon name="next" /></span>
              </button>)}
            </article>}
            {(["monthly", "quarterly", "annual", "once"] as const).map(frequency => {
              const entries = costItems.filter(item => (item.frequency ?? "monthly") === frequency);
              if (!entries.length) return null;
              const title = { monthly: "Monatliche Kosten", quarterly: "Quartalsweise Kosten", annual: "Jährliche Kosten", once: "Einmalige Rechnungen" }[frequency];
              return <article className="detail-card category-card" key={frequency}>
                <h3>{title}</h3>
                {entries.map(item => <button className="detail-row forecast-entry" type="button" key={item.id} onClick={() => openFocusedEditor("expenses", undefined, "item:" + item.id)}>
                  <span>{item.name}<small>{item.category}{frequency === "once" ? ` · ${item.dueDate} · ${item.paid ? "Beglichen" : "Offen"}` : frequency !== "monthly" ? ` · ${months[item.month ?? 0]}` : ""}{frequency !== "once" && item.bookingDay ? ` · am ${item.bookingDay}.` : ""}</small></span>
                  <b>{exactEuros.format(compareAmount(expenseAmount(item, today), item.vatRate))}</b><span aria-hidden="true"><UiIcon name="next" /></span>
                </button>)}
              </article>;
            })}
            {costDetail.category && <button className="edit-chip" type="button" onClick={() => openFocusedEditor("expenses", undefined, costDetail.category)}>Kategorie bearbeiten</button>}
            <button className="add-card" type="button" onClick={() => openFocusedEditor("expenses", "expense", costDetail.category)}><span>+</span><strong>Neue Ausgabe</strong><small>Betrag, Kategorie und optional Buchungstag</small></button>
          </div>
        </section>}

        {activeView === "loans" && <section className="view" aria-labelledby="loans-title">
          <ViewHeader id="loans-title" eyebrow="Verbindlichkeiten" title="Alle Kredite im Blick" total={{ value: metrics.totalDebt, label: "Restschuld" }} copy={business ? "Restschulden und monatliche Raten." : "Restschuld, Monatsrate und rechnerische Laufzeit gebündelt an einem Ort."} />
          <div className="summary-grid"><SummaryCard label="Raten pro Monat" value={metrics.payments} tone="coral" />
            {active.commitments.some(item => item.highPriority) && <article className="summary-card"><span>Restschuld · Hohe Priorität</span><strong>{exactEuros.format(active.commitments.reduce((sum, item) => sum + (item.highPriority ? item.balance : 0), 0))}</strong></article>}
          </div>
          <div className="loan-grid">{active.commitments.map((item) => {
            const original = source.commitments.find(loan => loan.id === item.id)!;
            const repayment = loanSchedule(original, today);
            const projection = loanProjection(item);
            const share = metrics.totalDebt ? Math.round((item.balance / metrics.totalDebt) * 100) : 0;
            const hasDetails = Boolean(item.interestRate || item.termMonths || item.extraPayment);
            const details = <><div className="loan-stats">
              {repayment.repaidPrincipal !== null && <div><span>Schon getilgt</span><b>{exactEuros.format(repayment.repaidPrincipal)} von {exactEuros.format(original.originalPrincipal!)}</b></div>}
              {repayment.lifetimeInterest !== null && <div><span>Zinsen und ggf. Gebühren gesamt · geschätzt</span><b>{exactEuros.format(repayment.lifetimeInterest)}</b></div>}
              <div><span>{original.paidBefore === undefined ? "Rückzahlung ab erfasstem Stand inkl. Zinsen" : "Gesamte Rückzahlung inkl. Zinsen"}</span><b>{repayment.total === null ? "Mit dieser Rate nicht berechenbar" : exactEuros.format(repayment.total)}</b></div>{(!original.balanceDate || !original.bookingDay) && <small>Für die automatische Tilgung bitte Stichtag und Buchungstag ergänzen.</small>}{!business && <div><span>Effektive Monatsrate{item.bookingDay ? ` · am ${item.bookingDay}.` : ""}</span><b>{euro(projection.payment)}</b></div>}<div><span>Voraussichtlich offen</span><b>{repayment.remainingMonths === null ? "–" : `${repayment.remainingMonths} Monate`}</b></div>{item.interestRate ? <div><span>Zinskosten geschätzt</span><b>{repayment.remainingInterest === null ? "Rate und Zinssatz prüfen" : marketPrice(repayment.remainingInterest)}</b></div> : null}</div>{item.termMonths && projection.balanceAtTerm > 1 ? <p className="loan-warning">Nach der angegebenen Laufzeit wären noch etwa {euro(projection.balanceAtTerm)} offen.</p> : <p>{hasDetails ? `${item.interestRate || 0}% p. a.${item.extraPayment ? ` · ${euro(item.extraPayment)} extra` : ""}` : "Berechnet mit 0 % Jahreszins."}</p>}</>;
            return <article className={`loan-card${business ? " compact-loan" : ""}`} key={item.id}>
              <div className="loan-top">
                {item.highPriority ? <span className="loan-priority">Hohe Priorität</span> : <span className="loan-mark"><UiIcon name="loans" /></span>}
                <button className="edit-chip" type="button" onClick={() => openFocusedEditor("loans", undefined, item.id)}>Ändern</button>
              </div>
              {!business && <span className="loan-share">{item.category || "Kreditraten"} · {share}% der Restschuld</span>}
              <h2>{item.name}</h2><strong>{exactEuros.format(item.balance)}</strong>
              {business ? <>
                <div className="loan-monthly-rate">{exactEuros.format(monthlyLoanPayment(item))} pro Monat{item.bookingDay ? ` · am ${item.bookingDay}.` : ""}</div>
                <details className="loan-details"><summary>Vertragsdetails</summary>{details}</details>
              </> : details}
            </article>;
          })}<button className="add-card" type="button" onClick={() => openFocusedEditor("loans", "loan")}><span>+</span><strong>Neuen Kredit anlegen</strong><small>Restschuld und Rate reichen für den Start</small></button></div>
          {!business && <article className="principle-card"><span>✦</span><div><p>Njora-Prinzip</p><strong>Restschuld und Monatsbelastung gehören zusammen.</strong><small>So siehst du nicht nur, wie viel offen ist, sondern auch, wie stark die Kredite deinen Alltag binden.</small></div></article>}
        </section>}

        {!business && activeView === "goals" && <section className="view" aria-labelledby="goals-title">
          <ViewHeader id="goals-title" eyebrow="Ziele & Projekte" title="Wofür du deinen Überschuss nutzt" total={{ value: active.goals.reduce((sum, goal) => sum + goal.saved, 0), label: "Bereits gespart" }} copy="Ziele sind keine Fixkosten. Erst mit einem Zieldatum berechnet Njora, welcher Betrag aus deinem Überschuss monatlich nötig wäre." />
          <div className="summary-grid"><SummaryCard label="Überschuss vor Zielen" value={metrics.available} tone={metrics.available < 0 ? "negative" : "coral"} /><SummaryCard label="Bedarf für Terminziele" value={metrics.goalNeed} tone={metrics.goalNeed > metrics.available ? "negative" : "sage"} /></div>
          <div className="goal-grid">{active.goals.map((goal) => {
            const progress = goal.target > 0 ? Math.min((goal.saved / goal.target) * 100, 100) : 0;
            const remaining = Math.max(goal.target - goal.saved, 0);
            const monthlyNeed = goalMonthlyNeed(goal);
            return <article className="goal-card" key={goal.id}><div className="goal-card-header"><div><span>{goal.name}</span><b>{Math.round(progress)}%</b></div><button className="edit-chip" type="button" onClick={() => openFocusedEditor("goals", undefined, goal.id)}>Ändern</button></div><strong>{euro(goal.saved)} <small>von {euro(goal.target)}</small></strong><div className="goal-progress"><i style={{ width: `${progress}%` }} /></div><div className="goal-meta"><span>{remaining ? `${euro(remaining)} offen` : "Ziel erreicht"}</span><span>{goal.targetDate ? `${euro(monthlyNeed)} nötig / Monat` : "flexibel aus Überschuss"}</span></div></article>;
          })}<button className="add-card" type="button" onClick={() => openFocusedEditor("goals", "goal")}><span>+</span><strong>Neues Ziel hinzufügen</strong><small>Zielbetrag und optionales Zieldatum festlegen</small></button></div>
          {savingsOverview}
          <article className="detail-card goal-allocation"><div className="section-title compact"><div><p className="eyebrow">Machbarkeitscheck</p><h2>Was deine Termine erfordern</h2></div></div>{active.goals.map((goal) => <div className="allocation-line" key={goal.id}><span>{goal.name}<small>{validCalendarDay(goal.targetDate) ? `bis ${new Intl.DateTimeFormat("de-DE", { month: "short", year: "numeric" }).format(new Date(`${goal.targetDate}T12:00:00`))}` : goal.targetDate ? "Datum bitte prüfen" : "ohne festen Termin"}</small></span><strong>{goal.targetDate ? `${euro(goalMonthlyNeed(goal))} / Monat` : "flexibel"}</strong></div>)}<div className="allocation-total"><span>Rechnerischer Bedarf aus Terminzielen</span><strong>{euro(metrics.goalNeed)}</strong></div><p className={`goal-feasibility ${metrics.goalNeed > metrics.available ? "warning" : ""}`}>{metrics.goalNeed === 0 ? "Ohne Zieldatum bleibt dein gesamter Überschuss frei verteilbar." : metrics.goalNeed <= metrics.available ? `Nach allen Terminzielen blieben rechnerisch ${euro(metrics.available - metrics.goalNeed)} pro Monat frei.` : `Die Terminziele übersteigen deinen Überschuss um ${euro(metrics.goalNeed - metrics.available)} pro Monat.`}</p></article>
        </section>}

        {grant === null && activeView === "more" && <section className="view" aria-labelledby="more-title">
          <ViewHeader id="more-title" eyebrow="Account & Einstellungen" title="Dein persönlicher Bereich" copy={cloudUser?.local ? "Lokale Datenhaltung und die Pflege deines Finanzplans an einem Ort." : "Synchronisierung, Datenschutz und die Pflege deines Finanzplans an einem Ort."} />
          {billing?.active !== false && <><article className="detail-card annual-card"><div className="section-title compact"><div><h2>Fälligkeiten im Jahresverlauf</h2></div></div><div className="month-strip">{months.map((month, index) => {
            const sum = active.expenses.filter((item) => item.frequency && item.frequency !== "monthly" && isExpenseDue(item, index)).reduce((total, item) => total + item.amount, 0);
            return <div className={`month-cell ${sum ? "has-cost" : ""} ${index === currentMonth ? "current" : ""}`} key={month}><span>{month}</span><strong>{sum ? euro(sum) : "–"}</strong></div>;
          })}</div><button className="edit-chip annual-edit" type="button" onClick={() => openFocusedEditor("expenses")}>Fixkosten bearbeiten</button></article>
          {business && savingsOverview}
          <button className="settings-card" type="button" onClick={openEditor}><span className="settings-icon">N</span><div><strong>Finanzplan bearbeiten</strong><small>Konten, Einnahmen, Kosten, {business ? "Vermögenswerte" : "Ziele, Ersparnisse"} und Rhythmus</small></div><b><UiIcon name="next" /></b></button>
          </>}
          <a className="settings-card" href={sharePath}><strong>{business?"Business":"Privat"} teilen und Freigaben verwalten</strong></a>
          <article className="account-card">
            <h3>Business-Dashboards</h3>
            <label className="comparison-basis">Standardansicht<select value={defaultBasis} disabled={savingBasis} onChange={event => void saveDashboardBasis(event.target.value === "net" ? "net" : "gross")}>
              <option value="gross">Brutto</option><option value="net">Netto</option>
            </select></label>
            {basisError && <p role="alert">{basisError}</p>}
          </article>
          <AppearancePicker {...appearance} />
          <InstallAppCard />
          <NativeSettingsCard cadence={active.checkInCadence} />
          {billing && <article className="account-card"><BillingOffer workspace={space} billing={billing} /></article>}
          {/* This API endpoint serves its own HTML document and needs a full navigation. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <article className="account-card"><h3>ChatGPT</h3><a href="/api/chatgpt/manage">Verbindung verwalten</a></article>
          <article className="account-card"><div className="account-card-head"><span>{cloudUser?.displayName.charAt(0).toUpperCase() || "N"}</span><div><p>{cloudUser?.local ? "Lokale Version" : "E-Mail-Konto"}</p><strong>{cloudUser?.local ? cloudUser.displayName : cloudUser?.email}</strong>{cloudUser?.local && <small>Keine Anmeldung erforderlich</small>}</div></div><div className="account-status"><span><i className={syncStatus === "saving" ? "saving" : ""} />{syncLabel}</span><small>{remoteUpdatedAt ? `Zuletzt ${new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(remoteUpdatedAt))}` : cloudUser?.local ? "Noch keine lokale Speicherung" : "Noch keine Cloud-Speicherung"}</small></div><div className="account-actions"><button type="button" disabled={!plan} onClick={exportPlan}>Daten exportieren</button>{!cloudUser?.local && <button type="button" onClick={signOut}>Abmelden</button>}</div><details className="danger-zone"><summary>{cloudUser?.local ? "Lokale Finanzdaten löschen" : "Account und Finanzdaten löschen"}</summary><p>{cloudUser?.local ? "Diese Aktion löscht deinen Finanzplan endgültig aus der lokalen Entwicklungsdatenbank." : "Diese Aktion löscht dein Passwortkonto, alle Sitzungen und deinen Finanzplan endgültig aus der Njora-Cloud."}</p>{!cloudUser?.local && <p>Ein Web-Abo endet sofort. Ein App-Store-Abo läuft nach der Kontolöschung weiter, auch in der Probezeit. Kündige es vor dem Löschen in deinen <a href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noopener noreferrer">Apple-Abonnements</a>, um weitere Abbuchungen zu vermeiden. Der bisherige Kauf ist an dieses Njora-Konto gebunden.</p>}<label>Zur Bestätigung LÖSCHEN eingeben<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /></label><button type="button" disabled={deleteConfirmation !== "LÖSCHEN" || deletingAccount} onClick={deleteAccount}>{deletingAccount ? "Wird gelöscht …" : "Endgültig löschen"}</button></details></article>
          <article className="privacy-card"><span>{cloudUser?.local ? "Lokale Entwicklung" : "Dein persönlicher Bereich"}</span><p>{cloudUser?.local ? "Auf localhost ist keine Anmeldung nötig. Die Daten bleiben in der lokalen Entwicklungsdatenbank und werden nicht mit einem Online-Account synchronisiert." : "Deine Finanzdaten werden deinem angemeldeten Account zugeordnet und zwischen deinen Geräten synchronisiert. Eine Bankverbindung ist nicht erforderlich."}</p></article>
          <LegalLinks />
        </section>}
      </div>

      <nav className="bottom-nav" aria-label="Mobile Hauptnavigation">
        <MobileNavButton icon="today" label="Heute" active={activeView === "home"} onClick={() => navigate("home")} />
        {business && <MobileNavButton icon="revenue" label="Umsatz" active={activeView === "revenue"} onClick={() => navigate("revenue")} />}
        <MobileNavButton icon="calendar" label="Monatsplan" active={activeView === "month"} onClick={() => navigate("month")} />
        <MobileNavButton icon="loans" label="Kredite" active={activeView === "loans"} onClick={() => navigate("loans")} />
        {!business && <MobileNavButton icon="goals" label="Ziele" active={activeView === "goals"} onClick={() => navigate("goals")} />}
        <MobileNavButton icon="more" label="Mehr" active={activeView === "more"} onClick={() => navigate("more")} />
      </nav>

      <footer><span>Njora</span><p>{cloudUser?.local ? "Lokal gespeichert · ohne Anmeldung" : "Persönlich synchronisiert · ohne Kontoanbindung"}</p><span>Verstehe, was war. Gestalte, was kommt.</span></footer>

      {billing?.active !== false && showLegacyPrompt && legacyPlan && <div className="modal-backdrop"><section className="migration-card" role="dialog" aria-modal="true" aria-labelledby="migration-title"><span className="migration-icon"><UiIcon name="external" /></span><p className="eyebrow">Lokale Daten gefunden</p><h2 id="migration-title">Gehört dieser Finanzplan dir?</h2><p>{cloudUser?.local ? "Auf diesem Gerät liegt ein früherer lokaler Plan. Du kannst ihn jetzt in die lokale Entwicklungsdatenbank übernehmen." : "Auf diesem Gerät liegt ein früherer lokaler Plan. Erst mit deiner Bestätigung wird er deinem persönlichen Account zugeordnet und online synchronisiert."}</p><div><button className="secondary-button" type="button" onClick={() => setShowLegacyPrompt(false)}>Neu beginnen</button><button className="primary-button" type="button" onClick={importLegacyPlan} disabled={syncStatus === "saving"}>Ja, sicher übernehmen <b><UiIcon name="forward" /></b></button></div><small>{cloudUser?.local ? "Nach der Übernahme werden die alten lokalen Browserschlüssel entfernt." : "Nach erfolgreicher Übernahme werden die alten lokalen Schlüssel entfernt."}</small></section></div>}

      {billing?.active !== false && !plan && !showLegacyPrompt && <div className="modal-backdrop onboarding-backdrop"><section className="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="onboarding-top"><Brand /><span>Kurzer Fragebogen · etwa 3 Minuten</span></div>
        {workspacePicker}
        <a href={sharePath}>Einladungen und geteilte Bereiche</a>
        <div className="onboarding-progress-copy"><span>Schritt {onboardingStep + 1} von {onboardingSteps.length}</span><strong>{onboardingSteps[onboardingStep]}</strong></div>
        <div className="onboarding-progress" role="progressbar" aria-label="Fortschritt bei der Einrichtung" aria-valuemin={1} aria-valuemax={onboardingSteps.length} aria-valuenow={onboardingStep + 1}><i style={{ width: `${((onboardingStep + 1) / onboardingSteps.length) * 100}%` }} /></div>
        <ol className="onboarding-step-list" aria-label="Einrichtungsschritte">{onboardingSteps.map((step, index) => <li className={index === onboardingStep ? "active" : index < onboardingStep ? "done" : ""} key={step}><span>{index < onboardingStep ? "✓" : index + 1}</span><small>{step}</small></li>)}</ol>

        <form onSubmit={finishOnboarding} noValidate>
          <div className="onboarding-content">
            {onboardingStep === 0 && <>
              <p className="eyebrow">Willkommen bei Njora</p><h2 id="onboarding-title">{business ? "Wie heißt dein Unternehmen?" : "Wie möchtest du deinen Finanzplan nennen?"}</h2><p className="onboarding-intro">Lege fest, wie oft du deine Kontostände prüfen möchtest.</p>
              <div className="onboarding-fields two"><label><FieldTitle required>{business ? "Firmenname" : "Profilname"}</FieldTitle><input autoFocus maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={business ? "Firmenname" : "z. B. Mein Finanzplan"} /></label><label><FieldTitle required>Check-in-Rhythmus</FieldTitle><select value={draft.checkInCadence} onChange={(e) => setDraft({ ...draft, checkInCadence: e.target.value as Plan["checkInCadence"] })}><option value="weekly">wöchentlich</option><option value="daily">täglich</option></select></label></div>
            </>}

            {onboardingStep === 1 && <>
              <p className="eyebrow">Konten & Karten</p><h2 id="onboarding-title">Wo liegt dein Geld heute?</h2><p className="onboarding-intro">Nur Name und aktueller Stand – eine Bankverbindung oder IBAN ist nicht nötig.</p>
              <div className="onboarding-list">{draft.accounts.map((item, index) => <div className="onboarding-row account" key={item.id}><label><FieldTitle required={index === 0}>Name</FieldTitle><input maxLength={120} value={item.name} onChange={(e) => updateList("accounts", index, { name: e.target.value })} placeholder="z. B. Girokonto" /></label><label><FieldTitle>Aktueller Stand</FieldTitle><span className="currency-input"><DecimalInput fixedMinus={item.type === "credit"} value={item.balance} onValueChange={(value) => updateList("accounts", index, { balance: value })} placeholder="0" /><b>€</b></span></label><label><FieldTitle required={index === 0}>Art</FieldTitle><select value={item.type} onChange={(e) => updateList("accounts", index, { type: e.target.value as Account["type"], bookingDay: e.target.value === "credit" ? item.bookingDay : undefined })}><option value="bank">Konto</option><option value="credit">Kreditkarte</option><option value="cash">Bargeld</option></select></label>{item.type === "credit" && <BookingDayField label="Monatlicher Abbuchungstag" day={item.bookingDay} update={bookingDay => updateList("accounts", index, { bookingDay })} />}<RemoveButton onClick={() => removeListItem("accounts", index)} /></div>)}</div>
              <AddButton onClick={() => setDraft({ ...draft, accounts: [...draft.accounts, { id: uid(), name: "", type: "bank", balance: 0 }] })}>Konto oder Karte</AddButton>
            </>}

            {onboardingStep === 2 && <>
              <p className="eyebrow">{business ? "Betriebseinnahmen" : "Monatliches Einkommen"}</p><h2 id="onboarding-title">Was kommt regelmäßig rein?</h2><p className="onboarding-intro">{business ? "Feste Einnahmen sind optional. Den tatsächlichen Monatsumsatz trägst du beim Check-in ein." : "Ein monatlicher Betrag reicht für den Start. Weitere oder jährliche Einnahmen kannst du später ergänzen."}</p>
              <div className="onboarding-list">{draft.incomes.filter((item) => !item.annual).map((item) => ({ item, index: draft.incomes.findIndex((entry) => entry.id === item.id) })).map(({ item, index }) => <div className="onboarding-row income" key={item.id}><label><FieldTitle required={!business}>Quelle</FieldTitle><input maxLength={120} value={item.name} onChange={(e) => updateList("incomes", index, { name: e.target.value })} placeholder={business ? "z. B. Servicevertrag" : "z. B. Gehalt"} /></label>{business ? <BusinessAmount item={item} day={today} update={patch => updateList("incomes", index, patch)} /> : <label><FieldTitle required={!business}>Monatlicher Betrag</FieldTitle><span className="currency-input"><DecimalInput value={item.amount} onValueChange={(value) => updateList("incomes", index, { amount: value })} placeholder="0" /><b>€</b></span></label>}<BookingDayField day={item.bookingDay} update={bookingDay => updateList("incomes", index, { bookingDay })} /><RemoveButton onClick={() => removeListItem("incomes", index)} /></div>)}</div>
              {!editorTarget && <AddButton onClick={() => setDraft({ ...draft, incomes: [...draft.incomes, { id: uid(), name: "", amount: 0, annual: false }] })}>Einkommensquelle</AddButton>}
            </>}

            {onboardingStep === 3 && <>
              <p className="eyebrow">Fixkosten</p><h2 id="onboarding-title">Was geht regelmäßig raus?</h2><p className="onboarding-intro">Dieser Schritt ist optional. Starte mit den größten Fixkosten; weitere Details kannst du jederzeit nachtragen.</p>
              <div className="optional-note"><b>Optional</b><span>Du kannst direkt weitergehen.</span></div>
              <div className="onboarding-list">{draft.expenses.map((item, index) => <div className="onboarding-row expense" key={item.id}><label><FieldTitle>Bezeichnung</FieldTitle><input maxLength={120} value={item.name} onChange={(e) => updateList("expenses", index, { name: e.target.value })} placeholder="z. B. Miete" /></label>{business ? <BusinessAmount item={item} day={today} update={patch => updateList("expenses", index, patch)} /> : <label><FieldTitle>Betrag</FieldTitle><span className="currency-input"><DecimalInput value={expenseAmount(item, today)} onValueChange={(amount) => updateList("expenses", index, { amount, rateChanges: item.rateChanges?.filter(rate => rate.date > today) })} placeholder="0" /><b>€</b></span></label>}<label><FieldTitle>Kategorie</FieldTitle><select value={item.category} onChange={(e) => updateList("expenses", index, { category: e.target.value })}>{categoryOptions.map((category) => <option key={category}>{category}</option>)}</select></label><ExpenseScheduleFields business={business} item={item} update={(patch) => updateList("expenses", index, patch)} /><RemoveButton onClick={() => removeListItem("expenses", index)} /></div>)}</div>
              <AddButton onClick={() => setDraft({ ...draft, expenses: [...draft.expenses, { id: uid(), name: "", amount: 0, category: business ? "Betriebskosten" : "Wohnen", bookingDay: 0 }] })}>Ausgabe</AddButton>
            </>}

            {onboardingStep === 4 && <>
              <p className="eyebrow">Kredite</p><h2 id="onboarding-title">Zahlst du einen Kredit zurück?</h2><p className="onboarding-intro">Eine vereinbarte Rate kannst du hier in deinen Monatsplan aufnehmen.</p>
              <div className="onboarding-optional-groups">
              <section><div className="onboarding-group-head"><div><strong>Kredite & Verpflichtungen</strong><small>Optional</small></div><AddButton onClick={() => setDraft({ ...draft, commitments: [...draft.commitments, { id: uid(), name: "", balanceDate: today, balance: 0, payment: 0, interestRate: 0, termMonths: 0, extraPayment: 0 }] })}>Kredit</AddButton></div>{draft.commitments.map((item, index) => <div className="onboarding-row loan" key={item.id}><label>Kreditname<input maxLength={120} aria-label="Kreditname" value={item.name} onChange={(e) => updateList("commitments", index, { name: e.target.value })} placeholder="z. B. Autokredit" /></label><label>Restschuld<span className="currency-input"><DecimalInput aria-label="Restschuld" value={item.balance} onValueChange={(value) => updateList("commitments", index, { balance: value })} placeholder="Restschuld" /><b>€</b></span></label><label>Monatsrate<span className="currency-input"><DecimalInput aria-label="Monatsrate" value={item.payment} onValueChange={(value) => updateList("commitments", index, { payment: value })} placeholder="Monatsrate" /><b>€</b></span></label>{originalPrincipalField(item, index)}<label>Stand der Restschuld<input type="date" max={today} value={item.balanceDate ?? ""} onChange={e => updateList("commitments", index, { balanceDate: e.target.value || undefined })} /></label><label>Bis zum Stichtag gezahlt (€ · optional)<DecimalInput value={item.paidBefore} onValueChange={paidBefore => updateList("commitments", index, { paidBefore })} /></label>{loanCategoryField(item, index)}{loanPriorityField(item, index)}<BookingDayField day={item.bookingDay} update={bookingDay => updateList("commitments", index, { bookingDay })} /><RemoveButton onClick={() => removeListItem("commitments", index)} /></div>)}</section></div>
            </>}

            {onboardingStep === 5 && <>
              <p className="eyebrow">Ziele & Abschluss</p><h2 id="onboarding-title">Wofür möchtest du Raum schaffen?</h2><p className="onboarding-intro">Ziele sind optional. Danach ist dein Finanzplan bereit; Ersparnisse und Wertpapiere kannst du später in Ruhe ergänzen.</p>
              <div className="optional-note"><b>Optional</b><span>Ohne Ziel kannst du die Einrichtung direkt abschließen.</span></div>
              <div className="onboarding-list">{draft.goals.map((item, index) => <div className="onboarding-row goal" key={item.id}><label><FieldTitle>Ziel</FieldTitle><input maxLength={120} value={item.name} onChange={(e) => updateList("goals", index, { name: e.target.value })} placeholder="z. B. Notgroschen" /></label><label><FieldTitle>Zielbetrag</FieldTitle><span className="currency-input"><DecimalInput value={item.target} onValueChange={(value) => updateList("goals", index, { target: value })} placeholder="0" /><b>€</b></span></label><label><FieldTitle>Schon gespart</FieldTitle><span className="currency-input"><DecimalInput value={item.saved} onValueChange={(value) => updateList("goals", index, { saved: value })} placeholder="0" /><b>€</b></span></label><RemoveButton onClick={() => removeListItem("goals", index)} /></div>)}</div>
              <AddButton onClick={() => setDraft({ ...draft, goals: [...draft.goals, { id: uid(), name: "", target: 0, saved: 0, monthly: 0, targetDate: "" }] })}>Ziel</AddButton>
              <div className="onboarding-summary"><span>✓</span><div><strong>Deine Übersicht ist gleich bereit.</strong><p>{draft.accounts.filter((item) => item.name.trim()).length} Konten/Karten · {draft.incomes.filter((item) => !item.annual && item.amount > 0).length} Einkommen · {draft.expenses.filter((item) => item.amount > 0).length} Ausgaben</p></div></div>
            </>}
          </div>

          {onboardingError && <p className="onboarding-error" role="alert">{onboardingError}</p>}
          {saveNotice}
          <div className="onboarding-actions"><button className="secondary-button" type="button" onClick={previousOnboardingStep} disabled={onboardingStep === 0}>Zurück</button><span>{syncStatus === "saving" ? "Wird sicher gespeichert …" : onboardingStep < onboardingSteps.length - 1 ? "Du kannst Angaben später ändern." : "Bereit für deinen Überblick."}</span><button className="primary-button" type="submit" disabled={syncStatus === "saving"}>{onboardingStep < onboardingSteps.length - 1 ? <>Weiter <b><UiIcon name="forward" /></b></> : <>Njora starten <b><UiIcon name="forward" /></b></>}</button></div>
        </form>
      </section></div>}

      {billing?.active !== false && editing && plan && !showLegacyPrompt && <div className="modal-backdrop"><section className={`editor-card ${editorScope ? "focused-editor" : ""}`} role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <div className="editor-header"><div><p className="eyebrow">{currentEditorCopy?.eyebrow ?? "Dein lokaler Finanzplan"}</p><h2 id="editor-title">{currentEditorCopy?.title ?? (plan ? "Plan bearbeiten" : "Lass uns Klarheit schaffen.")}</h2></div>{plan && <button type="button" className="close-button" onClick={closeEditor} aria-label="Schließen">×</button>}</div>
        <p className="editor-intro">{currentEditorCopy?.intro ?? "Richte deinen Alltag einmal ein. Danach reichen kurze Check-ins, um jederzeit ein klares Bild zu haben."}</p>
        <form onSubmit={savePlan}><fieldset className="share-editor-fields" disabled={!!grant && access === "view"}>
          {!editorScope && <div className="editor-section basis-grid"><label>Profilname<input maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="z. B. Mein Budget" required /></label><label>Check-in-Rhythmus<select value={draft.checkInCadence} onChange={(e) => setDraft({ ...draft, checkInCadence: e.target.value as Plan["checkInCadence"] })}><option value="daily">täglich</option><option value="weekly">wöchentlich</option></select></label></div>}

          {(!editorScope || editorScope === "accounts") && <EditorSection id="editor-accounts" title="Konten & Karten" subtitle="Nur der aktuelle Stand – keine Bankverbindung nötig">
            {draft.accounts.map((item, index) => ({ item, index })).filter(({ item }) => !editorTarget || item.id === editorTarget).map(({ item, index }) => <div className="editor-row four" key={item.id}><label>Kontoname<input maxLength={120} aria-label="Kontoname" value={item.name} onChange={(e) => updateList("accounts", index, { name: e.target.value })} placeholder="z. B. Girokonto" /></label><label>Kontostand<DecimalInput aria-label="Aktueller Stand" fixedMinus={item.type === "credit"} value={item.balance} onValueChange={(value) => updateList("accounts", index, { balance: value })} placeholder="Stand" /></label><label>Kontotyp<select aria-label="Kontotyp" value={item.type} onChange={(e) => updateList("accounts", index, { type: e.target.value as Account["type"], bookingDay: e.target.value === "credit" ? item.bookingDay : undefined })}><option value="bank">Konto</option><option value="credit">Kreditkarte</option><option value="cash">Bargeld</option></select></label>{item.type === "credit" && <BookingDayField label="Monatlicher Abbuchungstag" day={item.bookingDay} update={bookingDay => updateList("accounts", index, { bookingDay })} />}<RemoveButton onClick={() => removeListItem("accounts", index)} /></div>)}
            {!editorTarget && <AddButton onClick={() => setDraft({ ...draft, accounts: [...draft.accounts, { id: uid(), name: "", type: "bank", balance: 0 }] })}>Konto oder Karte</AddButton>}
          </EditorSection>}

          {(!editorScope || editorScope === "income") && <EditorSection id="editor-income" title="Einkommen" subtitle="Monatlich und jährlich getrennt">
            {draft.incomes.map((item, index) => ({ item, index })).filter(({ item }) => !editorTarget || item.id === editorTarget).map(({ item, index }) => <IncomeEditorRow key={item.id} business={business} day={today} item={item}
              update={patch => updateList("incomes", index, patch)} remove={() => removeListItem("incomes", index)} />)}
            {!editorTarget && <AddButton onClick={() => setDraft({ ...draft, incomes: [...draft.incomes, { id: uid(), name: "", amount: 0, annual: false }] })}>Einkommensquelle</AddButton>}
          </EditorSection>}

          {editorScope === "specials" && <EditorSection id="editor-special-income" title="Jährliche Einnahmen" subtitle="Bonus, Weihnachtsgeld und andere planbare Sonderzuflüsse">
            {draft.incomes.map((item, index) => ({ item, index })).filter(({ item }) => item.annual).map(({ item, index }) => <IncomeEditorRow key={item.id} business={business} day={today} item={item} annualOnly
              update={patch => updateList("incomes", index, patch)} remove={() => removeListItem("incomes", index)} />)}
            <AddButton onClick={() => setDraft({ ...draft, incomes: [...draft.incomes, { id: uid(), name: "", amount: 0, annual: true, month: currentMonth }] })}>Jährliche Einnahme</AddButton>
          </EditorSection>}

          {(!editorScope || editorScope === "flexible") && <EditorSection id="editor-flexible" title="Monatliche Planwerte" subtitle="Die Prognose verteilt das Budget gleichmäßig über die Kalendertage.">
            {draft.flexibleCosts.map((item, index) => <div className="editor-row" key={item.id}>
              <label>Bezeichnung<input required maxLength={120} value={item.name} onChange={e => updateList("flexibleCosts", index, { name: e.target.value })} placeholder={business ? "z. B. Material" : "z. B. Lebensmittel"} /></label>
              {business ? <BusinessAmount item={item} day={today} signed={false} update={patch => updateList("flexibleCosts", index, patch)} /> :
                <label>Monatsbudget (€)<DecimalInput signed={false} value={item.amount} onValueChange={amount => updateList("flexibleCosts", index, { amount })} placeholder="0,00" /></label>}
              <RemoveButton onClick={() => removeListItem("flexibleCosts", index)} />
            </div>)}
            <AddButton onClick={() => setDraft(current => ({ ...current, flexibleCosts: [...current.flexibleCosts, { id: uid(), name: "", amount: 0 }] }))}>Planwert</AddButton>
          </EditorSection>}
          {(!editorScope || editorScope === "expenses" || editorScope === "specials") && <EditorSection id="editor-expenses" title="Fixkosten" subtitle="Betrag, Rhythmus und Fälligkeit">
            {editorTarget && !editorTarget.startsWith("item:") && <div className="category-color-editor"><div><span className="category-color-preview" style={{ backgroundColor: draft.categoryColors[editorTarget] ?? defaultCategoryColors[editorTarget] }} /><span><strong>Kategoriefarbe</strong><small>Für Diagramm und Monatsübersicht</small></span></div><label><input aria-label={`Farbe für ${editorTarget}`} type="color" value={draft.categoryColors[editorTarget] ?? defaultCategoryColors[editorTarget]} onChange={(e) => setDraft({ ...draft, categoryColors: { ...draft.categoryColors, [editorTarget]: e.target.value } })} /></label></div>}
            {draft.expenses.map((item, index) => ({ item, index })).filter(({ item }) => editorScope !== "specials" || (item.frequency && item.frequency !== "monthly")).filter(({ item }) => !editorTarget || (editorTarget.startsWith("item:") ? item.id === editorTarget.slice(5) : item.category === editorTarget)).map(({ item, index }) => <div className="editor-row expense-edit" key={item.id}><label>Ausgabe<input maxLength={120} aria-label="Ausgabe" value={item.name} onChange={(e) => updateList("expenses", index, { name: e.target.value })} placeholder="z. B. Miete" /></label>{business ? <BusinessAmount item={item} day={today} update={patch => updateList("expenses", index, patch)} /> : <label>Betrag je Zahlung (€)<DecimalInput aria-label="Betrag je Zahlung" value={expenseAmount(item, today)} onValueChange={(amount) => updateList("expenses", index, { amount, rateChanges: item.rateChanges?.filter(rate => rate.date > today) })} placeholder="Betrag je Zahlung" /></label>}<label>Kategorie<select aria-label="Kategorie" value={item.category} disabled={Boolean(editorTarget && !editorTarget.startsWith("item:"))} onChange={(e) => updateList("expenses", index, { category: e.target.value })}>{categoryOptions.map((category) => <option key={category}>{category}</option>)}</select></label>{item.frequency !== "once" && <label>Buchungstag<input aria-label="Buchungstag" type="number" inputMode="numeric" min="1" max="31" value={item.bookingDay || ""} onChange={(e) => updateList("expenses", index, { bookingDay: Math.min(Math.max(numberValue(e.target.value), 0), 31) })} placeholder="Tag optional" /></label>}<ExpenseScheduleFields business={business} item={item} update={(patch) => updateList("expenses", index, patch)} /><RemoveButton onClick={() => removeListItem("expenses", index)} /></div>)}
            {!editorTarget?.startsWith("item:") && <AddButton onClick={() => setDraft({ ...draft, expenses: [...draft.expenses, { id: uid(), name: "", amount: 0, category: editorTarget ?? (business ? "Betriebskosten" : "Wohnen"), bookingDay: 0, ...(editorScope === "specials" ? { frequency: "annual" as const, month: currentMonth } : {}) }] })}>Ausgabe</AddButton>}
          </EditorSection>}


          {(!editorScope || editorScope === "loans") && <EditorSection id="editor-loans" title="Kredite & Verpflichtungen" subtitle="Restschuld und Rate reichen aus; Vertragsdetails verbessern die Prognose">
            {draft.commitments.map((item, index) => ({ item, index })).filter(({ item }) => !editorTarget || item.id === editorTarget).map(({ item, index }) => <div className="loan-editor-item" key={item.id}><div className="editor-row four"><label>Kreditname<input maxLength={120} aria-label="Verpflichtung" value={item.name} onChange={(e) => updateList("commitments", index, { name: e.target.value })} placeholder="z. B. Immobilienkredit" /></label><label>Restschuld am Stichtag (€)<DecimalInput aria-label="Restbetrag" value={item.balance} onValueChange={(value) => updateList("commitments", index, { balance: value })} placeholder="Restschuld" /></label><label>Monatsrate (€)<DecimalInput aria-label="Monatsrate" value={item.payment} onValueChange={(value) => updateList("commitments", index, { payment: value })} placeholder="Monatsrate" /></label><RemoveButton onClick={() => removeListItem("commitments", index)} /></div>{originalPrincipalField(item, index)}<label>Stand der Restschuld<input type="date" max={today} value={item.balanceDate ?? ""} onChange={e => updateList("commitments", index, { balanceDate: e.target.value || undefined })} /></label><label>Bis zum Stichtag gezahlt (€ · optional)<DecimalInput value={item.paidBefore} onValueChange={paidBefore => updateList("commitments", index, { paidBefore })} /></label>{loanCategoryField(item, index)}{loanPriorityField(item, index)}<BookingDayField day={item.bookingDay} update={bookingDay => updateList("commitments", index, { bookingDay })} /><details className="loan-details" open={Boolean(item.interestRate || item.termMonths || item.extraPayment)}><summary>Optionale Vertragsdetails für genauere Prognose</summary><div><label>Zinssatz p. a.<span className="currency-input"><DecimalInput aria-label="Zinssatz pro Jahr" value={item.interestRate} onValueChange={(value) => updateList("commitments", index, { interestRate: value })} placeholder="z. B. 3,5" /><b>%</b></span></label><label>Restlaufzeit<span className="currency-input"><input aria-label="Restlaufzeit in Monaten" type="number" min="0" step="1" inputMode="numeric" value={item.termMonths || ""} onChange={(e) => updateList("commitments", index, { termMonths: numberValue(e.target.value) })} placeholder="Monate" /><b>M</b></span></label><label>Zusätzliche Monatsrate<span className="currency-input"><DecimalInput aria-label="Zusätzliche monatliche Tilgung" value={item.extraPayment} onValueChange={(value) => updateList("commitments", index, { extraPayment: value })} placeholder="optional" /><b>€</b></span></label></div></details></div>)}
            {!editorTarget && <AddButton onClick={() => setDraft({ ...draft, commitments: [...draft.commitments, { id: uid(), name: "", balanceDate: today, balance: 0, payment: 0, interestRate: 0, termMonths: 0, extraPayment: 0 }] })}>Kredit oder Verpflichtung</AddButton>}
          </EditorSection>}

          {!business && (!editorScope || editorScope === "goals") && <EditorSection id="editor-goals" title="Ziele" subtitle="Zieldatum optional – Ziele werden nur aus deinem Überschuss bedient">
            {draft.goals.map((item, index) => ({ item, index })).filter(({ item }) => !editorTarget || item.id === editorTarget).map(({ item, index }) => <div className="editor-row five" key={item.id}><label>Ziel<input maxLength={120} aria-label="Ziel" value={item.name} onChange={(e) => updateList("goals", index, { name: e.target.value })} placeholder="z. B. Notgroschen" /></label><label>Zielbetrag (€)<DecimalInput aria-label="Zielbetrag" value={item.target} onValueChange={(value) => updateList("goals", index, { target: value })} placeholder="Zielbetrag" /></label><label>Schon gespart (€)<DecimalInput aria-label="Schon gespart" value={item.saved} onValueChange={(value) => updateList("goals", index, { saved: value })} placeholder="Schon gespart" /></label><label>Optionales Zieldatum<input aria-label="Optionales Zieldatum" type="date" value={item.targetDate || ""} onChange={(e) => updateList("goals", index, { targetDate: e.target.value })} /></label><RemoveButton onClick={() => removeListItem("goals", index)} /></div>)}
            {!editorTarget && <AddButton onClick={() => setDraft({ ...draft, goals: [...draft.goals, { id: uid(), name: "", target: 0, saved: 0, monthly: 0, targetDate: "" }] })}>Ziel</AddButton>}
          </EditorSection>}

          {(!editorScope || editorScope === "savings") && <EditorSection id="editor-savings" title={business ? "Vermögenswerte" : "Depot & Ersparnisse"} subtitle={business ? "Sachwerte und Geldanlagen des Unternehmens" : "ISIN und Stückzahl für automatische Schlusskurse oder einen manuellen Kurs eintragen"}>
            {draft.savings.map((item, index) => ({ item, index })).filter(({ item }) => !editorTarget || item.id === editorTarget).map(({ item, index }) => <div className="saving-editor-item" key={item.id}>
              <div className={`editor-row ${item.kind === "security" ? "saving-security-edit" : "saving-balance-edit"}`}>
                <label>Bezeichnung<input maxLength={120} aria-label={business ? "Bezeichnung des Vermögenswerts" : "Bezeichnung der Ersparnis"} value={item.name} onChange={(e) => updateList("savings", index, { name: e.target.value })} placeholder={item.kind === "security" ? "Wertpapiername" : business ? "z. B. Firmenlaptop" : "z. B. Notgroschen"} /></label>
                <label>{business ? "Art des Vermögenswerts" : "Art der Ersparnis"}<select aria-label={business ? "Art des Vermögenswerts" : "Art der Ersparnis"} value={item.kind} onChange={(e) => updateList("savings", index, { kind: e.target.value as SavingKind, ...(item.depreciationStart !== undefined ? { balance: depreciation(item, today)?.book ?? item.balance, depreciationStart: undefined, usefulLifeMonths: undefined, residualValue: undefined } : {}) })}>{Object.entries(assetKinds).map(([kind, label]) => <option value={kind} key={kind}>{label}</option>)}</select></label>
                {item.kind === "security" ? <>
                  <label>ISIN oder Börsensymbol<input aria-label="ISIN für automatische Schlusskurse oder Börsensymbol" value={item.symbol ?? ""} onChange={(e) => updateList("savings", index, { symbol: e.target.value.trim().toUpperCase(), price: 0, priceEur: 0, quoteVenue: undefined, quoteUpdatedAt: undefined })} placeholder="ISIN, z. B. DE0007164600" autoCapitalize="characters" /></label>
                  <label>Stückzahl<DecimalInput signed={false} aria-label="Stückzahl" value={item.quantity} onValueChange={(value) => updateList("savings", index, { quantity: Math.max(value, 0) })} placeholder="Stückzahl" /></label>
                  <label>Kurs in Euro<span className="currency-input"><DecimalInput signed={false} aria-label="Kurs in Euro" value={item.priceEur} onValueChange={(value) => updateList("savings", index, { priceEur: Math.max(value, 0), price: Math.max(value, 0), currency: "EUR", quoteUpdatedAt: new Date().toISOString(), quoteVenue: "Manuell" })} placeholder="Kurs in EUR" /><b>€</b></span></label>
                </> : <label>{business ? item.depreciationStart !== undefined ? "Anschaffungskosten" : "Wert" : "Aktueller Sparstand"}<span className="currency-input"><DecimalInput signed={false} aria-label={business ? item.depreciationStart !== undefined ? "Anschaffungskosten" : "Wert" : "Aktueller Sparstand"} value={item.balance} onValueChange={(value) => updateList("savings", index, { balance: Math.max(value, 0) })} placeholder="Aktueller Stand" /><b>€</b></span></label>}
                <RemoveButton onClick={() => removeListItem("savings", index)} />
              </div>
              {business && item.kind === "other" && <DepreciationFields asset={item} today={today} update={patch => updateList("savings", index, patch)} />}
              {item.kind === "security" && <div className="saving-quote-hint"><span>Aktueller Wert <b>{exactEuros.format(savingValue(item))}</b></span><small>{item.quoteUpdatedAt ? [marketPrice(item.price ?? 0, item.currency), savingPriceLabel(item)].filter(Boolean).join(" · ") : securityISIN(item.symbol) ? "Noch kein Cboe-Schlusskurs gespeichert" : "Kurs je Stück in Euro eintragen"}</small></div>}
            </div>)}
            {!editorTarget && <div className="saving-add-actions"><AddButton onClick={() => setDraft({ ...draft, savings: [...draft.savings, { id: uid(), name: "", kind: "security", balance: 0, symbol: "", quantity: 0, price: 0, priceEur: 0, currency: "EUR" }] })}>Wertpapier</AddButton><AddButton onClick={() => setDraft({ ...draft, savings: [...draft.savings, { id: uid(), name: "", kind: newSavingKind, balance: 0 }] })}>{business ? "Vermögenswert" : "Sparform"}</AddButton></div>}
          </EditorSection>}

          {!editorScope && <details className="data-import">
            <summary>Daten aus einer Njora-Sicherung importieren</summary>
            <textarea aria-label="Njora-Daten" value={importText} onChange={(event) => {
              setImportText(event.target.value);
              setImportPreview(null);
              setImportError("");
            }} placeholder="Njora-JSON hier einfügen" />
            <button type="button" onClick={previewImport}>Sicherung prüfen</button>
            {importError && <p role="alert">{importError}</p>}
            {importPreview && <div role="group" aria-label="Import bestätigen">
              <strong>{importPreview.name}</strong>
              <p>{importPreview.accounts.length} Konten · {importPreview.commitments.length} Kredite · {importPreview.snapshots.length} Check-ins</p>
              <p>Diese Sicherung ersetzt deinen aktuellen Finanzplan vollständig.</p>
              <button type="button" onClick={() => setImportPreview(null)}>Abbrechen</button>
              <button type="button" onClick={confirmImport} disabled={syncStatus === "saving"}>Aktuellen Plan ersetzen</button>
            </div>}
          </details>}

          {saveNotice}
          </fieldset>
          {grant && access === "view" ? <p>Du hast Lesezugriff.</p> : <div className="editor-actions"><span>{syncLabel}</span><button className="primary-button" type="submit" disabled={syncStatus === "saving"}>{editorScope ? "Änderungen speichern" : "Übersicht speichern"} <b><UiIcon name="forward" /></b></button></div>}
        </form>
      </section></div>}

      {billing?.active !== false && savingsOpen && <div className="modal-backdrop"><section className="savings-card" role="dialog" aria-modal="true" aria-labelledby="savings-title">
        <div className="editor-header"><div>{!business && <p className="eyebrow">Vermögen & Depot</p>}<h2 id="savings-title">{savingsTitle}</h2></div><TitleAmount value={savingsMetrics.total} label="Gesamtwert" /><button type="button" className="close-button" onClick={() => setSavingsOpen(false)} aria-label="Schließen">×</button></div>
        <p>Getrennt vom Kontostand und der Monatsprognose.</p>
        <div className="savings-toolbar"><div><button type="button" onClick={() => openFocusedEditor("savings", "security")}>+ Wertpapier</button><button type="button" onClick={() => openFocusedEditor("savings", "saving")}>+ {business ? "Vermögenswert" : "Sparform"}</button></div></div>
        {saveNotice}
        <div className="savings-list">{savingsMetrics.items.length ? savingsMetrics.items.map((item) => <article key={item.id}>
          <i style={{ backgroundColor: savingKindColors[item.kind] }} />
          <div><strong>{item.name || assetKinds[item.kind]}</strong><small>{item.kind === "security" ? `${item.symbol ? item.symbol + " · " : ""}${item.quantity || 0} Stück${item.quoteUpdatedAt ? ` · ${marketPrice(item.price ?? 0, item.currency)} · ${savingPriceLabel(item)}` : securityISIN(item.symbol) ? " · Noch kein Schlusskurs gespeichert" : ""}` : business && item.depreciationStart ? "Lineare Abschreibung · " + item.usefulLifeMonths + " Monate" : assetKinds[item.kind]}</small></div>
          <span><b>{exactEuros.format(item.value)}</b><small>{savingsMetrics.total ? `${Math.round((item.value / savingsMetrics.total) * 100)}%` : "0%"}</small></span>
          <button className="edit-chip" type="button" onClick={() => openFocusedEditor("savings", undefined, item.id)}>Ändern</button>
        </article>) : <div className="savings-empty"><span>◇</span><strong>{business ? "Noch keine Vermögenswerte erfasst" : "Noch keine Ersparnisse erfasst"}</strong><p>{business ? "Erfasse zum Beispiel einen Firmenlaptop oder ein Wertpapier." : "Füge dein erstes Wertpapier, Tagesgeldkonto oder eine andere Rücklage hinzu."}</p></div>}</div>
        <p className="market-note">Bei unterstützten ISINs bewertet Njora deine Stückzahl mit dem letzten verfügbaren Euro-Schlusskurs von Cboe Europe. Der Datenstand bezeichnet die Kursdatei. Bei selten gehandelten Titeln kann der Kurs älter sein.</p>
      </section></div>}

      {billing?.active !== false && checkingIn && <div className="modal-backdrop"><section className="checkin-card" role="dialog" aria-modal="true" aria-labelledby="checkin-title">
        <div className="editor-header"><div><p className="eyebrow">Konten & Karten</p><h2 id="checkin-title">Stände aktualisieren</h2></div><button type="button" className="close-button" onClick={() => setCheckingIn(false)} aria-label="Schließen">×</button></div>
        <p className="editor-intro">Ein Check-in für heute aktualisiert deine Konten. Frühere Stände werden im Verlauf ergänzt.</p>
        <form onSubmit={saveCheckIn}>
          <label>Stand vom<input type="date" max={localDay()} value={checkInDate} onChange={(e) => selectCheckInDate(e.target.value)} required /></label>
          {pastCheckIn && <p className="editor-intro">{previousCheckIn
            ? "Du bearbeitest den gespeicherten Stand dieses Tages. Frühere Konten bleiben im Verlauf erhalten."
            : "Für diesen Tag gibt es noch keinen Check-in. Die heutigen Beträge sind vorausgefüllt. Trage die damaligen Stände ein."}</p>}
          {business && revenueMonth && <div><p>{revenueMonthLabel(revenueMonth)}</p><RevenueFields draft={checkInRevenue} change={next => setRevenueDrafts(current => ({...current, [revenueMonth]: next}))} /></div>}
          <div className="checkin-accounts" key={checkInDate}>{checkInAccounts.map((account, index) => <div className="checkin-account-edit" key={account.id}><label>Kontoname<input disabled={pastCheckIn} maxLength={120} aria-label="Kontoname" value={account.name} onChange={(e) => setCheckInAccounts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: e.target.value } : item))} placeholder="Kontoname" /></label><label>Kontotyp<select disabled={pastCheckIn} aria-label={`Typ von ${account.name || "Konto"}`} value={account.type} onChange={(e) => setCheckInAccounts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, type: e.target.value as Account["type"] } : item))}><option value="bank">Konto</option><option value="credit">Kreditkarte</option><option value="cash">Bargeld</option></select></label><label>Kontostand<span className="currency-input"><DecimalInput aria-label={`Stand von ${account.name || "Konto"}`} fixedMinus={account.type === "credit"} value={account.balance} onValueChange={(value) => setCheckInAccounts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, balance: value } : item))} placeholder="Stand" /><b>€</b></span></label>{!pastCheckIn && checkInAccounts.length > 1 && <RemoveButton onClick={() => setCheckInAccounts((current) => current.filter((_, itemIndex) => itemIndex !== index))} />}</div>)}{!pastCheckIn && <button className="account-add-line" type="button" onClick={() => setCheckInAccounts((current) => [...current, { id: uid(), name: "", type: "bank", balance: 0 }])}><span>+</span> Konto oder Karte hinzufügen</button>}</div>
          <label>Notiz (optional)<input maxLength={500} value={checkInNote} onChange={(e) => setCheckInNote(e.target.value)} placeholder="z. B. Kreditkarte bereits ausgeglichen" /></label>
          <div className="checkin-preview"><span>Netto-Stand am gewählten Datum</span><strong>{exactEuros.format(checkInTotal)}</strong></div>
          {saveNotice}
          <button className="primary-button wide" type="submit" disabled={syncStatus === "saving" || (business && revenueAmount === null)}>Stand speichern <b><UiIcon name="forward" /></b></button>
        </form>
      </section></div>}
    </main>
  );
}

function Brand() {
  return <span className="brand-lockup" role="img" aria-label="Njora"><Image unoptimized className="brand-mark" src="/njora-mark-small.webp" width="42" height="42" alt="" /><Image unoptimized className="brand-wordmark" src="/njora-wordmark-small.webp" width="112" height="35" alt="" /></span>;
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={active ? "active" : ""} aria-current={active ? "page" : undefined} type="button" onClick={onClick}>{children}</button>;
}

function MobileNavButton({ icon, label, active, onClick }: { icon: IconName; label: string; active: boolean; onClick: () => void }) {
  return <button aria-label={label} className={active ? "active" : ""} aria-current={active ? "page" : undefined} type="button" onClick={onClick}><span aria-hidden="true"><UiIcon name={icon} /></span><small>{label}</small></button>;
}

type HeadingAmount = { value: number; label: string };

function TitleAmount({ value, label }: HeadingAmount) {
  return <div className="title-amount"><strong>{exactEuros.format(value)}</strong><small>{label}</small></div>;
}

function ViewHeader({ id, eyebrow, title, copy, total }: { id: string; eyebrow: string; title: string; copy: string; total?: HeadingAmount }) {
  return <header className="view-header"><p className="eyebrow">{eyebrow}</p>
    <div className="financial-heading"><h1 id={id}>{title}</h1>{total && <TitleAmount {...total} />}</div>
    <p>{copy}</p></header>;
}

function SummaryCard({ label, value, alternate, tone = "", onClick }: { label: string; value: number; alternate?: { value: number; label: string }; tone?: string; onClick?: () => void }) {
  if (onClick) return <button type="button" className={`summary-card month-link ${tone}`} onClick={onClick}><span>{label} <UiIcon name="next" /></span><strong>{exactEuros.format(value)}</strong>{alternate && <small>{exactEuros.format(alternate.value)} {alternate.label}</small>}</button>;
  return <article className={`summary-card ${tone}`}><span>{label}</span><strong>{euro(value)}</strong></article>;
}

function EditorSection({ id, title, subtitle, children }: { id?: string; title: string; subtitle: string; children: React.ReactNode }) {
  return <section id={id} className="editor-section"><div className="editor-section-head"><div><h3>{title}</h3><p>{subtitle}</p></div></div>{children}</section>;
}

function IncomeEditorRow({ item, business, day, annualOnly = false, update, remove }: {
  business: boolean;
  day: string;
  item: IncomeSource;
  annualOnly?: boolean;
  update: (patch: Partial<IncomeSource>) => void;
  remove: () => void;
}) {
  return <div className={annualOnly ? "income-fields annual-income" : "income-fields"}>
    <label>Einkommensquelle<input maxLength={120} value={item.name} onChange={e => update({ name: e.target.value })}
      placeholder={business ? "z. B. Servicevertrag" : annualOnly ? "z. B. Weihnachtsgeld" : "z. B. Gehalt"} /></label>
    {business ? <BusinessAmount item={item} day={day} update={update} /> : <label>Betrag (€)<DecimalInput value={item.amount} onValueChange={amount => update({ amount })} /></label>}
    {!annualOnly && <label>Rhythmus<select value={item.annual ? "annual" : "monthly"} onChange={e => {
      const annual = e.target.value === "annual";
      update({ annual, month: annual ? item.month : undefined });
    }}><option value="monthly">monatlich</option><option value="annual">jährlich</option></select></label>}
    <label>Eingangsmonat<select disabled={!item.annual} value={item.annual ? item.month ?? "" : ""}
      onChange={e => update({ month: e.target.value === "" ? undefined : Number(e.target.value) })}>
      <option value="">{item.annual ? "Monat wählen" : "jeden Monat"}</option>
      {months.map((month, index) => <option key={month} value={index}>{month}</option>)}
    </select></label>
    <BookingDayField day={item.bookingDay} update={bookingDay => update({ bookingDay })} />
    <RemoveButton onClick={remove} />
  </div>;
}

function BookingDayField({ day, update, label = "Buchungstag" }: { day?: number; label?: string; update: (day: number) => void }) {
  return <label>{label}<select value={day ?? 0} onChange={event => update(Number(event.target.value))}>
    <option value={0}>Kein fester Tag</option>
    {Array.from({ length: 31 }, (_, index) => <option key={index} value={index + 1}>{index + 1}.</option>)}
  </select></label>;
}

function BusinessAmount({ item, day, update, signed = true }: { signed?: boolean; item: FlexibleCost & Pick<Expense, "rateChanges">; day: string; update: (patch: Partial<Expense>) => void }) {
  const [rateDraft, setRateDraft] = useState<string | null>(null);
  const gross = expenseAmount(item, day);
  const rate = item.vatRate ?? 0;
  const net = netFromGross(gross, rate);
  const basis = item.vatBasis ?? "gross";
  function setGross(amount: number, extra: Partial<Expense> = {}) {
    update(amount === gross ? extra : { ...extra, amount, ...(item.rateChanges ? {rateChanges: item.rateChanges.filter(change => change.date > day)} : {}) });
  }
  return <div className="payment-fields vat-fields">
    <label>Eingabe als<select value={basis} onChange={event => update({ vatBasis: event.target.value as VatBasis })}>
      <option value="gross">Brutto</option><option value="net">Netto</option>
    </select></label>
    <label>{basis === "net" ? "Nettobetrag" : "Bruttobetrag"} (€)<DecimalInput key={basis} signed={signed} value={basis === "net" ? net : gross}
      onValueChange={amount => setGross(basis === "net" ? grossFromNet(amount, rate) : amount)} placeholder="0,00" /></label>
    <label>Steuersatz (%)<input type="text" inputMode="decimal" value={rateDraft ?? (item.vatRate === undefined ? "" : String(rate).replace(".", ","))}
      onFocus={() => { if (rate === 0) setRateDraft(""); }}
      onChange={event => {
        const text = event.target.value;
        if (!/^\d{0,3}(?:[,.]\d{0,2})?$/.test(text)) return;
        const next = Number(text.replace(",", ".") || 0);
        if (!Number.isFinite(next) || next > 100) return;
        setRateDraft(text);
        const storedRate = text === "" ? undefined : next;
        if (storedRate !== item.vatRate) setGross(basis === "net" && rate !== next ? grossFromNet(net, next) : gross, { vatRate: storedRate });
      }} onBlur={() => setRateDraft(null)} /></label>
    <span className="vat-summary">{exactEuros.format(net)} netto · {exactEuros.format(gross - net)} USt. · {exactEuros.format(gross)} brutto</span>
  </div>;
}

function ExpenseScheduleFields({ item, update, business }: { business: boolean; item: Expense; update: (patch: Partial<Expense>) => void }) {
  return <div className="payment-fields">
    <label>Zahlungsrhythmus<select value={item.frequency ?? "monthly"} onChange={(event) => {
      const frequency = event.target.value as Frequency;
      update({ frequency, month: frequency === "quarterly" || frequency === "annual" ? item.month ?? new Date().getMonth() : undefined,
        dueDate: frequency === "once" ? item.dueDate ?? localDay() : undefined, paid: frequency === "once" ? Boolean(item.paid) : undefined,
        amount: expenseAmount(item), rateChanges: frequency === "monthly" ? item.rateChanges : undefined });
    }}>{Object.entries(frequencies).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    {item.frequency === "once" && <>
      <label>Fälligkeit<input type="date" value={item.dueDate ?? ""} required onChange={event => update({dueDate: event.target.value})} /></label>
      <label><input type="checkbox" checked={Boolean(item.paid)} onChange={event => update({paid: event.target.checked})} /> Bezahlt</label>
    </>}
    {item.rateChanges?.filter(rate => rate.date > localDay()).map(rate => <div key={rate.date}>
      <label>Monatsbetrag{business ? (item.vatBasis === "net" ? " netto" : " brutto") : ""} ab {rate.date}<DecimalInput key={item.vatBasis} value={business && item.vatBasis === "net" ? netFromGross(rate.amount, item.vatRate ?? 0) : rate.amount} onValueChange={amount => update({rateChanges: item.rateChanges?.map(r => r.date === rate.date ? {...r, amount: business && item.vatBasis === "net" ? grossFromNet(amount, item.vatRate ?? 0) : amount} : r)})} /></label>
      <button type="button" onClick={() => update({rateChanges: item.rateChanges?.filter(r => r.date !== rate.date)})}>Änderung entfernen</button>
    </div>)}
    {(item.frequency === "annual" || item.frequency === "quarterly") && <label>Fälligkeitsmonat<select value={item.month ?? 0} onChange={(event) => update({ month: Number(event.target.value) })}>
      {months.map((label, index) => <option key={label} value={index}>{label}</option>)}
    </select></label>}
  </div>;
}

function FieldTitle({ required = false, children }: { required?: boolean; children: React.ReactNode }) {
  return <span className="field-title"><span>{children}</span><small className={required ? "required" : "optional"}>{required ? "Pflicht" : "Optional"}</small></span>;
}

function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button className="add-row" type="button" onClick={onClick}>+ {children} hinzufügen</button>;
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return <button className="remove-row" type="button" onClick={onClick} aria-label="Eintrag entfernen">×</button>;
}
