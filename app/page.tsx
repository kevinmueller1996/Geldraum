"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { isLocalHostname } from "./local-host";

type IncomeSource = { id: string; name: string; amount: number; annual: boolean; month?: number };
type Expense = { id: string; name: string; amount: number; category: string; bookingDay?: number };
type AnnualCost = { id: string; name: string; amount: number; month: number };
type Commitment = { id: string; name: string; balance: number; payment: number; interestRate?: number; termMonths?: number; extraPayment?: number };
type Goal = { id: string; name: string; target: number; saved: number; monthly: number; targetDate?: string };
type SavingKind = "security" | "dayMoney" | "fixedDeposit" | "buildingSavings" | "cash" | "other";
type SavingAsset = { id: string; name: string; kind: SavingKind; balance: number; symbol?: string; quantity?: number; price?: number; priceEur?: number; currency?: string; quoteUpdatedAt?: string };
type SecuritySuggestion = { symbol: string; name: string; exchange: string; exchangeName: string; type: "Aktie" | "ETF" | "Fonds" };
type Account = { id: string; name: string; type: "bank" | "credit" | "cash"; balance: number };
type Snapshot = { id: string; date: string; balances: Record<string, number>; note: string; netBalance?: number };
type View = "home" | "month" | "loans" | "goals" | "more";
type EditorScope = "accounts" | "income" | "expenses" | "annual" | "specials" | "loans" | "goals" | "savings";
type Plan = {
  name: string;
  liquidity: number;
  categoryColors: Record<string, string>;
  incomes: IncomeSource[];
  expenses: Expense[];
  annualCosts: AnnualCost[];
  commitments: Commitment[];
  goals: Goal[];
  savings: SavingAsset[];
  accounts: Account[];
  snapshots: Snapshot[];
  checkInCadence: "daily" | "weekly";
  scenario: { name: string; cost: number; equity: number };
};
type CloudUser = { displayName: string; email: string; local?: boolean };
type AuthStatus = "loading" | "authenticated" | "anonymous" | "unavailable";
type SyncStatus = "idle" | "saving" | "saved" | "error" | "conflict";
type QuoteStatus = "idle" | "loading" | "updated" | "error";

const STORAGE_KEY = "klarbudget-plan-v3";
const PREVIOUS_STORAGE_KEY = "klarbudget-plan-v2";
const OLD_STORAGE_KEY = "klarbudget-profile";
const months = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const categories = ["Wohnen", "Versicherungen", "Mobilität", "Kommunikation", "Lebenshaltung", "Abos & Sonstiges"];
const onboardingSteps = ["Basis", "Konten", "Einkommen", "Ausgaben", "Jahresplanung", "Ziele"] as const;
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

function euro(value: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value || 0);
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

function dateTimeLabel(value?: string) {
  if (!value) return "unbekannt";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unbekannt" : new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function numberValue(value: string) {
  return Number(value.replace(",", ".")) || 0;
}

function loanProjection(item: Commitment) {
  const monthlyRate = Math.max(item.interestRate ?? 0, 0) / 1200;
  const payment = Math.max(item.payment + (item.extraPayment ?? 0), 0);
  const balanceAfter = (monthsAhead: number) => {
    if (!payment) return item.balance;
    if (!monthlyRate) return Math.max(item.balance - payment * monthsAhead, 0);
    const factor = Math.pow(1 + monthlyRate, monthsAhead);
    return Math.max(item.balance * factor - payment * ((factor - 1) / monthlyRate), 0);
  };
  let calculatedMonths = 0;
  if (payment > 0) {
    calculatedMonths = monthlyRate > 0
      ? payment > item.balance * monthlyRate ? Math.ceil(-Math.log(1 - (monthlyRate * item.balance) / payment) / Math.log(1 + monthlyRate)) : 0
      : Math.ceil(item.balance / payment);
  }
  const monthsLeft = item.termMonths || calculatedMonths;
  const interestCost = calculatedMonths ? Math.max(payment * calculatedMonths - item.balance, 0) : 0;
  return { payment, monthsLeft, calculatedMonths, interestCost, balanceIn12Months: balanceAfter(12), balanceAtTerm: monthsLeft ? balanceAfter(monthsLeft) : item.balance };
}

function goalMonthlyNeed(goal: Goal) {
  if (!goal.targetDate) return 0;
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

function normalizePlan(value: Partial<Plan>): Plan {
  const base = emptyPlan(value.name ?? "");
  return {
    ...base,
    ...value,
    categoryColors: { ...defaultCategoryColors, ...(value.categoryColors ?? {}) },
    incomes: (value.incomes ?? base.incomes).map((item) => ({ ...item, month: item.annual ? item.month : undefined })),
    expenses: (value.expenses ?? base.expenses).map((item) => ({ ...item, bookingDay: item.bookingDay ?? 0 })),
    annualCosts: value.annualCosts ?? [],
    commitments: (value.commitments ?? []).map((item) => ({ ...item, interestRate: item.interestRate ?? 0, termMonths: item.termMonths ?? 0, extraPayment: item.extraPayment ?? 0 })),
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
    accounts: value.accounts?.length ? value.accounts : base.accounts,
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
  const [plan, setPlan] = useState<Plan | null>(null);
  const [draft, setDraft] = useState<Plan>(emptyPlan());
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editorScope, setEditorScope] = useState<EditorScope | null>(null);
  const [editorTarget, setEditorTarget] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [savingsOpen, setSavingsOpen] = useState(false);
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>("idle");
  const [quoteMessage, setQuoteMessage] = useState("");
  const [activeView, setActiveView] = useState<View>("home");
  const [checkInAccounts, setCheckInAccounts] = useState<Account[]>([]);
  const [checkInDate, setCheckInDate] = useState("");
  const [checkInNote, setCheckInNote] = useState("");
  const [importText, setImportText] = useState("");
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null);
  const [isLocalMode, setIsLocalMode] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [remoteRevision, setRemoteRevision] = useState<number | null>(null);
  const [remoteUpdatedAt, setRemoteUpdatedAt] = useState<string | null>(null);
  const [legacyPlan, setLegacyPlan] = useState<Plan | null>(null);
  const [showLegacyPrompt, setShowLegacyPrompt] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingError, setOnboardingError] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const localRuntime = isLocalHostname(window.location.hostname);
      setIsLocalMode(localRuntime);
      let localPlan: Plan | null = null;
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(PREVIOUS_STORAGE_KEY);
        localPlan = saved ? normalizePlan(JSON.parse(saved) as Partial<Plan>) : migrateOldProfile();
      } catch {
        localPlan = null;
      }

      try {
        const response = await fetch("/api/account", { cache: "no-store" });
        if (cancelled) return;
        if (response.status === 401) {
          setAuthStatus(localRuntime ? "unavailable" : "anonymous");
          setReady(true);
          return;
        }
        if (!response.ok) throw new Error("account unavailable");
        const data = await response.json() as { user: CloudUser; plan: Partial<Plan> | null; revision: number | null; updatedAt: string | null };
        setCloudUser(data.user);
        setRemoteRevision(data.revision);
        setRemoteUpdatedAt(data.updatedAt);
        setAuthStatus("authenticated");
        if (data.plan) {
          const loaded = normalizePlan(data.plan);
          setPlan(loaded);
          setDraft(loaded);
          setSyncStatus("saved");
        } else {
          const fresh = emptyPlan(data.user.displayName.split(" ")[0] || "Mein Budget");
          setDraft(fresh);
          if (localPlan) {
            setLegacyPlan(localPlan);
            setShowLegacyPrompt(true);
          }
        }
      } catch {
        if (!cancelled) setAuthStatus("unavailable");
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void hydrate();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const modalOpen = checkingIn || editing || savingsOpen || showLegacyPrompt || (authStatus === "authenticated" && !plan);
    if (!modalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary") ?? []);
    window.setTimeout(() => focusable()[0]?.focus(), 20);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (checkingIn) setCheckingIn(false);
        else if (savingsOpen) setSavingsOpen(false);
        else if (editing && plan) { setEditing(false); setEditorScope(null); setEditorTarget(null); }
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
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [authStatus, checkingIn, editing, onboardingStep, plan, savingsOpen, showLegacyPrompt]);

  const active = plan ?? demoPlan;
  const metrics = useMemo(() => {
    const now = new Date();
    const income = active.incomes.filter((item) => !item.annual).reduce((sum, item) => sum + item.amount, 0);
    const annualIncome = active.incomes.filter((item) => item.annual).reduce((sum, item) => sum + item.amount, 0);
    const currentAnnualIncome = active.incomes.filter((item) => item.annual && item.month === now.getMonth()).reduce((sum, item) => sum + item.amount, 0);
    const currentAnnualCosts = active.annualCosts.filter((item) => item.month === now.getMonth()).reduce((sum, item) => sum + item.amount, 0);
    const expenses = active.expenses.reduce((sum, item) => sum + item.amount, 0);
    const annualTotal = active.annualCosts.reduce((sum, item) => sum + item.amount, 0);
    const annualReserve = annualTotal / 12;
    const payments = active.commitments.reduce((sum, item) => sum + item.payment + (item.extraPayment ?? 0), 0);
    const goalNeed = active.goals.reduce((sum, item) => sum + goalMonthlyNeed(item), 0);
    const available = income - expenses - annualReserve - payments;
    const unallocated = available;
    const baseCosts = expenses + annualReserve + payments;
    const burden = income > 0 ? Math.round((baseCosts / income) * 100) : 0;
    const bankBalance = active.accounts.filter((item) => item.type !== "credit").reduce((sum, item) => sum + item.balance, 0);
    const creditBalance = active.accounts.filter((item) => item.type === "credit").reduce((sum, item) => sum + item.balance, 0);
    const netBalance = bankBalance - creditBalance;
    const bufferMonths = baseCosts > 0 ? netBalance / baseCosts : 0;
    const currentMonthKey = new Date().toISOString().slice(0, 7);
    const monthSnapshots = active.snapshots.filter((item) => item.date.startsWith(currentMonthKey)).sort((a, b) => a.date.localeCompare(b.date));
    const snapshotNet = (snapshot: Snapshot) => snapshot.netBalance ?? active.accounts.reduce((sum, account) => sum + (account.type === "credit" ? -(snapshot.balances[account.id] ?? 0) : (snapshot.balances[account.id] ?? 0)), 0);
    const monthDelta = monthSnapshots.length > 1 ? snapshotNet(monthSnapshots.at(-1)!) - snapshotNet(monthSnapshots[0]) : 0;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const remainingShare = Math.max(daysInMonth - now.getDate(), 0) / daysInMonth;
    const remainingExpenses = active.expenses.reduce((sum, item) => {
      if (item.bookingDay) return sum + (item.bookingDay > now.getDate() ? item.amount : 0);
      return sum + item.amount * remainingShare;
    }, 0);
    const forecast = netBalance + (income + currentAnnualIncome) * remainingShare - remainingExpenses - (payments + currentAnnualCosts) * remainingShare;
    const totalDebt = active.commitments.reduce((sum, item) => sum + item.balance, 0);
    const plannedOutflow = expenses + annualReserve + payments;
    return { income, annualIncome, currentAnnualIncome, currentAnnualCosts, expenses, annualTotal, annualReserve, payments, goalNeed, available, unallocated, burden, bufferMonths, bankBalance, creditBalance, netBalance, monthDelta, forecast, totalDebt, plannedOutflow };
  }, [active]);

  const groupedExpenses = useMemo(() => categories.map((category) => ({
    category,
    value: active.expenses.filter((item) => item.category === category).reduce((sum, item) => sum + item.amount, 0),
    color: active.categoryColors[category] ?? defaultCategoryColors[category],
  })).filter((item) => item.value > 0).sort((a, b) => b.value - a.value), [active.expenses, active.categoryColors]);

  const savingsMetrics = useMemo(() => {
    const items = active.savings.map((item) => ({ ...item, value: savingValue(item) })).sort((a, b) => b.value - a.value);
    const total = items.reduce((sum, item) => sum + item.value, 0);
    const securities = items.filter((item) => item.kind === "security").reduce((sum, item) => sum + item.value, 0);
    const reserves = total - securities;
    const latestQuote = items.filter((item) => item.quoteUpdatedAt).sort((a, b) => (b.quoteUpdatedAt ?? "").localeCompare(a.quoteUpdatedAt ?? ""))[0]?.quoteUpdatedAt;
    return { items, total, securities, reserves, latestQuote };
  }, [active.savings]);

  function openEditor() {
    setDraft(structuredClone(plan ?? emptyPlan()));
    setEditorScope(null);
    setEditorTarget(null);
    setEditing(true);
  }

  function openFocusedEditor(section: EditorScope, add?: "account" | "income" | "expense" | "annual" | "loan" | "goal" | "security" | "saving", target?: string) {
    const next = structuredClone(plan ?? emptyPlan());
    let nextTarget = target ?? null;
    if (add === "account") next.accounts.push({ id: uid(), name: "", type: "bank", balance: 0 });
    if (add === "income") next.incomes.push({ id: uid(), name: "", amount: 0, annual: false, month: undefined });
    if (add === "expense") { const id = uid(); next.expenses.push({ id, name: "", amount: 0, category: target && categories.includes(target) ? target : "Lebenshaltung", bookingDay: 0 }); nextTarget = target && categories.includes(target) ? target : `item:${id}`; }
    if (add === "annual") next.annualCosts.push({ id: uid(), name: "", amount: 0, month: new Date().getMonth() });
    if (add === "loan") { const id = uid(); next.commitments.push({ id, name: "", balance: 0, payment: 0, interestRate: 0, termMonths: 0, extraPayment: 0 }); nextTarget = id; }
    if (add === "goal") { const id = uid(); next.goals.push({ id, name: "", target: 0, saved: 0, monthly: 0, targetDate: "" }); nextTarget = id; }
    if (add === "security") { const id = uid(); next.savings.push({ id, name: "", kind: "security", balance: 0, symbol: "", quantity: 0, price: 0, priceEur: 0, currency: "EUR" }); nextTarget = id; }
    if (add === "saving") { const id = uid(); next.savings.push({ id, name: "", kind: "dayMoney", balance: 0 }); nextTarget = id; }
    setSavingsOpen(false);
    setDraft(next);
    setEditorScope(section);
    setEditorTarget(nextTarget);
    setEditing(true);
    window.setTimeout(() => document.getElementById(`editor-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  }

  function closeEditor() {
    setEditing(false);
    setEditorScope(null);
    setEditorTarget(null);
  }

  async function persistPlan(next: Plan, revision = remoteRevision) {
    setSyncStatus("saving");
    try {
      const response = await fetch("/api/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: next, revision }),
      });
      if (response.status === 409) {
        setSyncStatus("conflict");
        return false;
      }
      if (!response.ok) throw new Error("save failed");
      const result = await response.json() as { revision: number; updatedAt: string };
      setRemoteRevision(result.revision);
      setRemoteUpdatedAt(result.updatedAt);
      setPlan(next);
      setDraft(next);
      setSyncStatus("saved");
      return true;
    } catch {
      setSyncStatus("error");
      return false;
    }
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim() || draft.incomes.reduce((sum, item) => sum + item.amount, 0) <= 0) return;
    const clean = normalizePlan({ ...draft, name: draft.name.trim(), savings: draft.savings.map((item) => ({ ...item, name: item.name.trim(), symbol: item.kind === "security" ? item.symbol?.trim().toUpperCase() : undefined })) });
    if (await persistPlan(clean)) {
      setEditing(false);
      setEditorScope(null);
      setEditorTarget(null);
    }
  }

  function onboardingIssue(step: number) {
    if (step === 0 && !draft.name.trim()) return "Bitte gib deinem Finanzplan einen Namen.";
    if (step === 1 && !draft.accounts.some((item) => item.name.trim())) return "Bitte lege mindestens ein Konto oder eine Karte an.";
    if (step === 2 && !draft.incomes.some((item) => !item.annual && item.name.trim() && item.amount > 0)) return "Bitte trage mindestens ein monatliches Einkommen mit Betrag ein.";
    if (step === 3 && draft.expenses.some((item) => item.amount > 0 && !item.name.trim())) return "Bitte ergänze zu jedem eingetragenen Betrag eine Bezeichnung.";
    if (step === 4 && draft.annualCosts.some((item) => !item.name.trim() || item.amount <= 0)) return "Bitte vervollständige die angelegten Jahreskosten oder entferne den Eintrag.";
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

  function openCheckIn() {
    setCheckInAccounts(structuredClone(active.accounts));
    setCheckInDate(new Date().toISOString().slice(0, 10));
    setCheckInNote("");
    setCheckingIn(true);
  }

  async function saveCheckIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!plan) return;
    const accounts = checkInAccounts.map((account) => ({ ...account, name: account.name.trim() || "Unbenanntes Konto" }));
    const balances = Object.fromEntries(accounts.map((account) => [account.id, account.balance]));
    const netBalance = accounts.reduce((sum, account) => sum + (account.type === "credit" ? -account.balance : account.balance), 0);
    const snapshot: Snapshot = { id: uid(), date: checkInDate, balances, note: checkInNote.trim(), netBalance };
    const updated: Plan = {
      ...plan,
      accounts,
      snapshots: [...plan.snapshots.filter((item) => item.date !== snapshot.date), snapshot].sort((a, b) => a.date.localeCompare(b.date)),
    };
    if (await persistPlan(updated)) setCheckingIn(false);
  }

  async function importPlan() {
    try {
      const imported = normalizePlan(JSON.parse(importText) as Partial<Plan>);
      if (await persistPlan(imported)) {
        setEditing(false);
        setEditorScope(null);
        setEditorTarget(null);
        setImportText("");
      }
    } catch {
      return;
    }
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

  function exportPlan() {
    if (!plan) return;
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `njora-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function deleteAccount() {
    if (deleteConfirmation !== "LÖSCHEN") return;
    setDeletingAccount(true);
    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      if (!response.ok) throw new Error("delete failed");
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(PREVIOUS_STORAGE_KEY);
      window.localStorage.removeItem(OLD_STORAGE_KEY);
      window.location.href = cloudUser?.local ? "/" : "/login";
    } catch {
      setSyncStatus("error");
      setDeletingAccount(false);
    }
  }

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  function openSavings() {
    setSavingsOpen(true);
    setQuoteMessage("");
    const staleSecurity = plan?.savings.some((item) => {
      if (item.kind !== "security" || !item.symbol) return false;
      const updatedAt = item.quoteUpdatedAt ? new Date(item.quoteUpdatedAt).getTime() : Number.NaN;
      return !Number.isFinite(updatedAt) || Date.now() - updatedAt > 15 * 60 * 1000;
    });
    if (staleSecurity) void refreshQuotes();
  }

  async function refreshQuotes() {
    if (!plan || quoteStatus === "loading") return;
    const securities = plan.savings.filter((item) => item.kind === "security" && item.symbol?.trim());
    if (!securities.length) {
      setQuoteStatus("idle");
      setQuoteMessage("Lege zuerst ein Wertpapier mit Börsensymbol an.");
      return;
    }
    setQuoteStatus("loading");
    setQuoteMessage("");
    try {
      const response = await fetch("/api/market/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: [...new Set(securities.map((item) => item.symbol!.trim().toUpperCase()))] }),
      });
      if (!response.ok) throw new Error("quote request failed");
      const result = await response.json() as {
        quotes: Array<{ symbol: string; name: string; price: number; priceEur: number; currency: string; marketTime: string }>;
        errors: Array<{ symbol: string }>;
      };
      const quotes = new Map(result.quotes.map((quote) => [quote.symbol, quote]));
      const updated: Plan = {
        ...plan,
        savings: plan.savings.map((item) => {
          if (item.kind !== "security") return item;
          const quote = quotes.get(item.symbol?.trim().toUpperCase() ?? "");
          if (!quote) return item;
          return { ...item, name: item.name.trim() || quote.name, symbol: quote.symbol, price: quote.price, priceEur: quote.priceEur, currency: quote.currency, quoteUpdatedAt: quote.marketTime };
        }),
      };
      if (result.quotes.length && !await persistPlan(updated)) throw new Error("quote save failed");
      setQuoteStatus(result.errors.length ? "error" : "updated");
      setQuoteMessage(result.errors.length
        ? `${result.quotes.length} aktualisiert · ${result.errors.length} Symbol${result.errors.length === 1 ? "" : "e"} nicht gefunden.`
        : `${result.quotes.length} Kurs${result.quotes.length === 1 ? "" : "e"} aktualisiert.`);
    } catch {
      setQuoteStatus("error");
      setQuoteMessage("Kurse konnten gerade nicht aktualisiert werden. Die zuletzt gespeicherten Werte bleiben erhalten.");
    }
  }

  function updateList<T extends keyof Pick<Plan, "incomes" | "expenses" | "annualCosts" | "commitments" | "goals" | "savings" | "accounts">>(key: T, index: number, patch: Partial<Plan[T][number]>) {
    setDraft((current) => ({
      ...current,
      [key]: current[key].map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  }

  function removeListItem(key: keyof Pick<Plan, "incomes" | "expenses" | "annualCosts" | "commitments" | "goals" | "savings" | "accounts">, index: number) {
    setDraft((current) => ({ ...current, [key]: current[key].filter((_, itemIndex) => itemIndex !== index) }));
  }

  if (!ready) return <main className="loading" aria-label="Njora wird geladen"><span className="loading-mark" /></main>;
  if (authStatus === "anonymous") return <main className="auth-shell"><section className="auth-card"><Brand /><p className="eyebrow">Deine Finanzen. Deine Möglichkeiten.</p><h1>Verstehe, was war.<br /><em>Gestalte, was kommt.</em></h1><p>Kontostände, Monatsplan, Kredite, Ziele und Ersparnisse – sicher getrennt in deinem persönlichen Bereich.</p><a className="auth-button" href="/login">Mit E-Mail anmelden <b>→</b></a><small>Dein Passwort wird verschlüsselt gehasht; deine Finanzdaten bleiben deinem Konto zugeordnet.</small></section><aside className="auth-visual login-visual" aria-hidden="true"><div className="brand-story-lockup"><img src="/njora-mark.png" width="260" height="260" alt="" /><img src="/njora-wordmark.png" width="300" height="94" alt="" /></div><div className="brand-story-rule" /><div className="brand-story-copy"><strong>Verstehe, was war.</strong><em>Gestalte, was kommt.</em><span>Dein persönlicher Finanzüberblick</span></div></aside></main>;
  if (authStatus === "unavailable") return <main className="auth-shell"><section className="auth-card"><Brand /><p className="eyebrow">Kurz nicht erreichbar</p><h1>{isLocalMode ? "Lokale Version wird vorbereitet." : "Deine Daten bleiben sicher."}</h1><p>{isLocalMode ? "Die lokale Datenbank konnte gerade nicht erreicht werden. Eine Anmeldung ist für localhost nicht erforderlich." : "Njora konnte die persönliche Cloud gerade nicht erreichen. Bitte versuche es in einem Moment erneut."}</p><button className="auth-button" type="button" onClick={() => window.location.reload()}>Erneut versuchen <b>↻</b></button></section></main>;

  const currentMonth = new Date().getMonth();
  const upcomingAnnual = [...active.annualCosts].sort((a, b) => ((a.month - currentMonth + 12) % 12) - ((b.month - currentMonth + 12) % 12));
  const lastSnapshot = [...active.snapshots].sort((a, b) => b.date.localeCompare(a.date))[0];
  const daysSinceUpdate = lastSnapshot ? Math.max(0, Math.floor((new Date().getTime() - new Date(`${lastSnapshot.date}T12:00:00`).getTime()) / 86400000)) : null;
  const lastUpdateLabel = lastSnapshot ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${lastSnapshot.date}T12:00:00`)) : "Noch kein Update";
  const updateDue = daysSinceUpdate === null || daysSinceUpdate >= (active.checkInCadence === "daily" ? 1 : 7);
  const currentMonthName = new Intl.DateTimeFormat("de-DE", { month: "long" }).format(new Date());
  const currentSpecials = [
    ...active.incomes.filter((item) => item.annual && item.month === currentMonth).map((item) => ({ id: `income-${item.id}`, name: item.name, amount: item.amount, type: "income" as const })),
    ...active.annualCosts.filter((item) => item.month === currentMonth).map((item) => ({ id: `cost-${item.id}`, name: item.name, amount: item.amount, type: "cost" as const })),
  ].sort((a, b) => b.amount - a.amount);
  const monthOutflows = [
    ...groupedExpenses.map((item) => ({ label: item.category, value: item.value, color: item.color })),
    ...(metrics.payments ? [{ label: "Kreditraten", value: metrics.payments, color: "#f2b1a5" }] : []),
    ...(metrics.annualReserve ? [{ label: "Jahresrücklage", value: metrics.annualReserve, color: "#e5ba58" }] : []),
  ].sort((a, b) => b.value - a.value);
  const editorCopy: Record<EditorScope, { eyebrow: string; title: string; intro: string }> = {
    accounts: { eyebrow: "Konten & Karten", title: "Konten bearbeiten", intro: "Passe ausschließlich deine Konten und Karten an. Aktuelle Stände pflegst du weiterhin am schnellsten über den Check-in." },
    income: { eyebrow: "Einkommen", title: "Einkommen bearbeiten", intro: "Pflege hier ausschließlich deine monatlichen und jährlichen Einkommensquellen. Jahreszuflüsse erscheinen nur in ihrem hinterlegten Monat." },
    expenses: { eyebrow: "Monatsplan", title: "Fixkosten bearbeiten", intro: "Hier änderst du nur deine wiederkehrenden monatlichen Ausgaben und deren Kategorien." },
    annual: { eyebrow: "Jahresplanung", title: "Jahreskosten bearbeiten", intro: "Pflege unregelmäßige Kosten mit Betrag und Fälligkeitsmonat – Njora berechnet daraus die Monatsrücklage." },
    specials: { eyebrow: "Sonderposten", title: "Unregelmäßig, aber planbar", intro: "Pflege jährliche Einnahmen und Ausgaben mit ihrem jeweiligen Monat. So weißt du frühzeitig, was besonders wird." },
    loans: { eyebrow: "Verbindlichkeiten", title: "Kredite bearbeiten", intro: "Passe Restschuld und Rate an oder ergänze optionale Vertragsdetails für eine genauere Prognose." },
    goals: { eyebrow: "Ziele", title: "Ziele bearbeiten", intro: "Lege Zielbetrag, aktuellen Stand und optional ein Zieldatum fest. Eine notwendige Sparrate wird nur für Terminziele berechnet." },
    savings: { eyebrow: "Vermögen & Depot", title: "Ersparnisse bearbeiten", intro: "Führe Wertpapiere mit Stückzahl und Börsensymbol oder andere Sparformen mit ihrem aktuellen Stand." },
  };
  let currentEditorCopy = editorScope ? editorCopy[editorScope] : null;
  if (editorScope === "expenses" && editorTarget) currentEditorCopy = editorTarget.startsWith("item:")
    ? { eyebrow: "Fixkosten", title: "Neue Ausgabe anlegen", intro: "Erfasse diese eine Ausgabe mit Betrag, Kategorie und optionalem Buchungstag." }
    : { eyebrow: "Fixkosten", title: `${editorTarget} bearbeiten`, intro: `Hier siehst und änderst du ausschließlich die Einträge aus der Kategorie ${editorTarget}.` };
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
    currentEditorCopy = { eyebrow: saving?.kind === "security" ? "Wertpapier" : "Ersparnis", title: saving?.name || (saving?.kind === "security" ? "Wertpapier hinzufügen" : "Sparform hinzufügen"), intro: saving?.kind === "security" ? "Börsensymbol und Stückzahl genügen. Den aktuellen Kurs kannst du anschließend automatisch abgleichen." : "Trage den aktuellen Stand dieser Sparform ein. Sie bleibt getrennt von deinem laufenden Kontostand." };
  }

  function navigate(view: View) {
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main id="top" className="page-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => navigate("home")} aria-label="Njora Startseite"><Brand /></button>
        <nav className="desktop-nav" aria-label="Hauptnavigation">
          <NavButton active={activeView === "home"} onClick={() => navigate("home")}>Heute</NavButton>
          <NavButton active={activeView === "month"} onClick={() => navigate("month")}>Monatsplan</NavButton>
          <NavButton active={activeView === "loans"} onClick={() => navigate("loans")}>Kredite</NavButton>
          <NavButton active={activeView === "goals"} onClick={() => navigate("goals")}>Ziele</NavButton>
          <NavButton active={activeView === "more"} onClick={() => navigate("more")}>Mehr</NavButton>
        </nav>
        <button className="profile-button" type="button" onClick={() => navigate("more")}><span>{active.name.charAt(0).toUpperCase()}</span><b>{active.name}</b></button>
      </header>

      {(syncStatus === "error" || syncStatus === "conflict") && <div className={`sync-banner ${syncStatus}`} role="status"><span>{syncStatus === "conflict" ? "Dieser Plan wurde auf einem anderen Gerät geändert." : "Die letzte Änderung konnte nicht online gespeichert werden."}</span><button type="button" onClick={() => window.location.reload()}>Neu laden</button></div>}

      <div className="app-content">
        {activeView === "home" && <section className="view home-view" aria-labelledby="home-title">
          <div className="mobile-greeting"><div><p className="eyebrow">{currentMonthName}</p><h1 id="home-title">Hallo {active.name}.</h1></div><span className={`mini-status ${updateDue ? "due" : ""}`}>{daysSinceUpdate === 0 ? "heute aktuell" : updateDue ? "Update fällig" : "aktuell"}</span></div>
          <button className="balance-hero" type="button" onClick={openCheckIn} aria-label="Konten und Karten aktualisieren">
            <div><p>Aktueller Kontostand</p><strong>{euro(metrics.netBalance)}</strong><span>{euro(metrics.bankBalance)} verfügbar · {euro(metrics.creditBalance)} Karten</span><small className="balance-updated">Zuletzt aktualisiert · {lastUpdateLabel}</small></div>
            <div className="balance-orbit"><span>{active.accounts.length}</span><small>öffnen →</small></div>
          </button>
          <div className="forecast-grid">
            <article className="forecast-card"><span>Forecast Monatsende</span><strong className={metrics.forecast < 0 ? "negative" : ""}>{euro(metrics.forecast)}</strong><p>mit hinterlegten Buchungstagen, sonst anteilig geschätzt</p></article>
            <button className="month-pulse month-specials" type="button" onClick={() => openFocusedEditor("specials")} aria-label={`Sonderposten im ${currentMonthName} anzeigen und bearbeiten`}><span>Besonders im {currentMonthName}</span>{currentSpecials.length ? <div className="specials-preview">{currentSpecials.slice(0, 2).map((item) => <div key={item.id}><b className={item.type === "income" ? "positive" : "negative"}>{item.type === "income" ? "+ " : "− "}{euro(item.amount)}</b><small>{item.name}</small></div>)}</div> : <strong className="specials-empty-label">Keine<br />Sonderposten</strong>}<p>{currentSpecials.length > 2 ? `+ ${currentSpecials.length - 2} weitere · ` : ""}Ansehen und planen →</p></button>
          </div>
          <article className="income-home-card"><div className="section-title compact"><div><p className="eyebrow">Einkommen</p><h2>Deine Zuflüsse</h2></div><button className="edit-chip" type="button" onClick={() => openFocusedEditor("income")}>Ändern</button></div><div className="income-group"><div className="income-group-head"><span>Monatlich</span><strong>{euro(metrics.income)}</strong></div>{active.incomes.filter((item) => !item.annual).map((item) => <div className="income-line" key={item.id}><div><strong>{item.name}</strong><small>regelmäßiger Monatszufluss</small></div><b>{euro(item.amount)}</b></div>)}</div><div className="income-group annual"><div className="income-group-head"><span>Jährlich</span><strong>{euro(metrics.annualIncome)}</strong></div>{active.incomes.filter((item) => item.annual).map((item) => <div className="income-line" key={item.id}><div><strong>{item.name}</strong><small>jährlicher Sonderzufluss</small></div><b>{euro(item.amount)}<small>{item.month === undefined ? "Monat noch festlegen" : `im ${months[item.month]}`}</small></b></div>)}</div></article>
        </section>}

        {activeView === "month" && <section className="view" aria-labelledby="month-title">
          <ViewHeader id="month-title" eyebrow={`Plan für ${currentMonthName}`} title="Wohin dein Geld geht" copy="Laufende Kosten, Kreditraten und Rücklagen – in Summe und anteilig." />
          <div className="summary-grid"><SummaryCard label="Monatliches Einkommen" value={metrics.income} /><SummaryCard label="Geplante Abflüsse" value={metrics.plannedOutflow} tone="coral" /></div>
          <article className="detail-card flow-detail">
            <div className="section-title compact"><div><p className="eyebrow">Verteilung</p><h2>Dein Monatsbudget</h2></div><div className="plan-position"><strong className={metrics.unallocated >= 0 ? "positive" : "negative"}>{metrics.unallocated >= 0 ? "+ " : "− "}{euro(Math.abs(metrics.unallocated))}</strong><span>{metrics.income > 0 ? Math.round((metrics.plannedOutflow / metrics.income) * 100) : 0}% verplant</span></div></div>
            <div className="stacked-bar" aria-label="Verteilung der geplanten Ausgaben">{monthOutflows.map((item) => <i style={{ width: `${metrics.plannedOutflow ? (item.value / metrics.plannedOutflow) * 100 : 0}%`, backgroundColor: item.color }} key={item.label} />)}</div>
            <div className="flow-list">{monthOutflows.map((item) => {
              const percent = metrics.plannedOutflow ? Math.round((item.value / metrics.plannedOutflow) * 100) : 0;
              return <div className="flow-item" key={item.label}><i style={{ backgroundColor: item.color }} /><div><strong>{item.label}</strong><span><em style={{ width: `${percent}%`, backgroundColor: item.color }} /></span></div><b>{euro(item.value)}<small>{percent}%</small></b></div>;
            })}</div>
          </article>
          <div className="category-details">{groupedExpenses.map((group) => <article className="detail-card category-card" style={{ "--category-color": group.color } as CSSProperties} key={group.category}><div className="category-head"><div><span className="category-label"><i style={{ backgroundColor: group.color }} />Kategorie</span><h3>{group.category}</h3></div><div><strong>{euro(group.value)}</strong><button className="edit-chip" type="button" onClick={() => openFocusedEditor("expenses", undefined, group.category)}>Ändern</button></div></div>{active.expenses.filter((item) => item.category === group.category).map((item) => <div className="detail-row" key={item.id}><span>{item.name}{item.bookingDay ? <small>Buchung am {item.bookingDay}.</small> : null}</span><b>{euro(item.amount)}</b></div>)}</article>)}<button className="add-card" type="button" onClick={() => openFocusedEditor("expenses", "expense")}><span>+</span><strong>Neue Ausgabe</strong><small>Betrag, Kategorie und optional Buchungstag</small></button></div>
        </section>}

        {activeView === "loans" && <section className="view" aria-labelledby="loans-title">
          <ViewHeader id="loans-title" eyebrow="Verbindlichkeiten" title="Alle Kredite im Blick" copy="Restschuld, Monatsrate und rechnerische Laufzeit gebündelt an einem Ort." />
          <div className="summary-grid"><SummaryCard label="Restschuld gesamt" value={metrics.totalDebt} /><SummaryCard label="Raten pro Monat" value={metrics.payments} tone="coral" /></div>
          <div className="loan-grid">{active.commitments.map((item) => {
            const projection = loanProjection(item);
            const share = metrics.totalDebt ? Math.round((item.balance / metrics.totalDebt) * 100) : 0;
            const hasDetails = Boolean(item.interestRate || item.termMonths || item.extraPayment);
            return <article className="loan-card" key={item.id}><div className="loan-top"><span className="loan-mark">↘</span><button className="edit-chip" type="button" onClick={() => openFocusedEditor("loans", undefined, item.id)}>Ändern</button></div><span className="loan-share">{share}% der Restschuld</span><h2>{item.name}</h2><strong>{euro(item.balance)}</strong><div className="loan-stats"><div><span>Effektive Monatsrate</span><b>{euro(projection.payment)}</b></div><div><span>Restschuld in 12 Mon.</span><b>{euro(projection.balanceIn12Months)}</b></div><div><span>Voraussichtlich offen</span><b>{projection.monthsLeft ? `${projection.monthsLeft} Monate` : "–"}</b></div>{item.interestRate ? <div><span>Zinskosten geschätzt</span><b>{euro(projection.interestCost)}</b></div> : null}</div>{item.termMonths && projection.balanceAtTerm > 1 ? <p className="loan-warning">Nach der angegebenen Laufzeit wären noch etwa {euro(projection.balanceAtTerm)} offen.</p> : <p>{hasDetails ? `${item.interestRate || 0}% p. a.${item.extraPayment ? ` · ${euro(item.extraPayment)} extra` : ""}` : "Basisprognose aus Restschuld und Rate."}</p>}</article>;
          })}<button className="add-card" type="button" onClick={() => openFocusedEditor("loans", "loan")}><span>+</span><strong>Neuen Kredit anlegen</strong><small>Restschuld und Rate reichen für den Start</small></button></div>
          <article className="principle-card"><span>✦</span><div><p>Njora-Prinzip</p><strong>Restschuld und Monatsbelastung gehören zusammen.</strong><small>So siehst du nicht nur, wie viel offen ist, sondern auch, wie stark die Kredite deinen Alltag binden.</small></div></article>
        </section>}

        {activeView === "goals" && <section className="view" aria-labelledby="goals-title">
          <ViewHeader id="goals-title" eyebrow="Ziele & Projekte" title="Wofür du deinen Überschuss nutzt" copy="Ziele sind keine Fixkosten. Erst mit einem Zieldatum berechnet Njora, welcher Betrag aus deinem Überschuss monatlich nötig wäre." />
          <div className="summary-grid"><SummaryCard label="Überschuss vor Zielen" value={metrics.available} tone={metrics.available < 0 ? "negative" : "coral"} /><SummaryCard label="Bedarf für Terminziele" value={metrics.goalNeed} tone={metrics.goalNeed > metrics.available ? "negative" : "sage"} /></div>
          <div className="goal-grid">{active.goals.map((goal) => {
            const progress = goal.target > 0 ? Math.min((goal.saved / goal.target) * 100, 100) : 0;
            const remaining = Math.max(goal.target - goal.saved, 0);
            const monthlyNeed = goalMonthlyNeed(goal);
            return <article className="goal-card" key={goal.id}><div className="goal-card-header"><div><span>{goal.name}</span><b>{Math.round(progress)}%</b></div><button className="edit-chip" type="button" onClick={() => openFocusedEditor("goals", undefined, goal.id)}>Ändern</button></div><strong>{euro(goal.saved)} <small>von {euro(goal.target)}</small></strong><div className="goal-progress"><i style={{ width: `${progress}%` }} /></div><div className="goal-meta"><span>{remaining ? `${euro(remaining)} offen` : "Ziel erreicht"}</span><span>{goal.targetDate ? `${euro(monthlyNeed)} nötig / Monat` : "flexibel aus Überschuss"}</span></div></article>;
          })}<button className="add-card" type="button" onClick={() => openFocusedEditor("goals", "goal")}><span>+</span><strong>Neues Ziel hinzufügen</strong><small>Zielbetrag und optionales Zieldatum festlegen</small></button></div>
          <button className="savings-overview-card" type="button" onClick={openSavings} aria-label="Depot und Ersparnisse öffnen">
            <div className="savings-overview-head"><div><p className="eyebrow">Vermögen & Depot</p><h2>Deine Ersparnisse</h2></div><span>Übersicht öffnen →</span></div>
            <strong>{euro(savingsMetrics.total)}</strong>
            {savingsMetrics.total > 0 ? <><div className="savings-split" aria-label="Aufteilung der Ersparnisse"><i style={{ width: `${(savingsMetrics.securities / savingsMetrics.total) * 100}%` }} /><i style={{ width: `${(savingsMetrics.reserves / savingsMetrics.total) * 100}%` }} /></div><div className="savings-overview-meta"><span><i />Wertpapiere {euro(savingsMetrics.securities)}</span><span><i />Weitere Rücklagen {euro(savingsMetrics.reserves)}</span></div></> : <p>Noch keine Ersparnisse hinterlegt · jetzt Depot oder Sparform hinzufügen</p>}
            <small>{savingsMetrics.latestQuote ? `Letzter Kursabgleich ${dateTimeLabel(savingsMetrics.latestQuote)}` : "Wertpapiere werden nach Symbol und Stückzahl bewertet"}</small>
          </button>
          <article className="detail-card goal-allocation"><div className="section-title compact"><div><p className="eyebrow">Machbarkeitscheck</p><h2>Was deine Termine erfordern</h2></div></div>{active.goals.map((goal) => <div className="allocation-line" key={goal.id}><span>{goal.name}<small>{goal.targetDate ? `bis ${new Intl.DateTimeFormat("de-DE", { month: "short", year: "numeric" }).format(new Date(`${goal.targetDate}T12:00:00`))}` : "ohne festen Termin"}</small></span><strong>{goal.targetDate ? `${euro(goalMonthlyNeed(goal))} / Monat` : "flexibel"}</strong></div>)}<div className="allocation-total"><span>Rechnerischer Bedarf aus Terminzielen</span><strong>{euro(metrics.goalNeed)}</strong></div><p className={`goal-feasibility ${metrics.goalNeed > metrics.available ? "warning" : ""}`}>{metrics.goalNeed === 0 ? "Ohne Zieldatum bleibt dein gesamter Überschuss frei verteilbar." : metrics.goalNeed <= metrics.available ? `Nach allen Terminzielen blieben rechnerisch ${euro(metrics.available - metrics.goalNeed)} pro Monat frei.` : `Die Terminziele übersteigen deinen Überschuss um ${euro(metrics.goalNeed - metrics.available)} pro Monat.`}</p></article>
        </section>}

        {activeView === "more" && <section className="view" aria-labelledby="more-title">
          <ViewHeader id="more-title" eyebrow="Account & Einstellungen" title="Dein persönlicher Bereich" copy={cloudUser?.local ? "Lokale Datenhaltung und die Pflege deines Finanzplans an einem Ort." : "Synchronisierung, Datenschutz und die Pflege deines Finanzplans an einem Ort."} />
          <article className="detail-card annual-card"><div className="section-title compact"><div><p className="eyebrow">Jahreskosten</p><h2>Unregelmäßig, aber planbar</h2></div><span>{euro(metrics.annualTotal)} im Jahr</span></div><div className="month-strip">{months.map((month, index) => {
            const sum = active.annualCosts.filter((item) => item.month === index).reduce((total, item) => total + item.amount, 0);
            return <div className={`month-cell ${sum ? "has-cost" : ""} ${index === currentMonth ? "current" : ""}`} key={month}><span>{month}</span><strong>{sum ? euro(sum) : "–"}</strong></div>;
          })}</div><div className="annual-list">{upcomingAnnual.map((item) => <article key={item.id}><span>{months[item.month]}</span><div><strong>{item.name}</strong><small>aus der Monatsrücklage</small></div><b>{euro(item.amount)}</b></article>)}<button className="annual-add" type="button" onClick={() => openFocusedEditor("annual", "annual")}><span>+</span><div><strong>Jahreskosten ergänzen</strong><small>Fälligkeit und Betrag eintragen</small></div></button></div><button className="edit-chip annual-edit" type="button" onClick={() => openFocusedEditor("annual")}>Jahreskosten ändern</button></article>
          <button className="settings-card" type="button" onClick={openEditor}><span className="settings-icon">N</span><div><strong>Finanzplan bearbeiten</strong><small>Konten, Einnahmen, Kosten, Ziele, Ersparnisse und Rhythmus</small></div><b>›</b></button>
          <article className="install-card"><span className="install-icon" aria-hidden="true">⇧</span><div><strong>Als App auf dem iPhone</strong><small>In Safari „Teilen“ öffnen und „Zum Home-Bildschirm“ wählen. Njora startet danach ohne Browserleiste.</small></div></article>
          <article className="account-card"><div className="account-card-head"><span>{cloudUser?.displayName.charAt(0).toUpperCase() || "N"}</span><div><p>{cloudUser?.local ? "Lokale Version" : "E-Mail-Konto"}</p><strong>{cloudUser?.displayName}</strong><small>{cloudUser?.local ? "Keine Anmeldung erforderlich" : cloudUser?.email}</small></div></div><div className="account-status"><span><i className={syncStatus === "saving" ? "saving" : ""} />{syncStatus === "saving" ? "Wird gespeichert" : cloudUser?.local ? "Lokal gespeichert" : "Online synchronisiert"}</span><small>{remoteUpdatedAt ? `Zuletzt ${new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(remoteUpdatedAt))}` : cloudUser?.local ? "Noch keine lokale Speicherung" : "Noch keine Cloud-Speicherung"}</small></div><div className="account-actions"><button type="button" onClick={exportPlan}>Daten exportieren</button>{!cloudUser?.local && <button type="button" onClick={signOut}>Abmelden</button>}</div><details className="danger-zone"><summary>{cloudUser?.local ? "Lokale Finanzdaten löschen" : "Account und Finanzdaten löschen"}</summary><p>{cloudUser?.local ? "Diese Aktion löscht deinen Finanzplan endgültig aus der lokalen Entwicklungsdatenbank." : "Diese Aktion löscht dein Passwortkonto, alle Sitzungen und deinen Finanzplan endgültig aus der Njora-Cloud."}</p><label>Zur Bestätigung LÖSCHEN eingeben<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /></label><button type="button" disabled={deleteConfirmation !== "LÖSCHEN" || deletingAccount} onClick={deleteAccount}>{deletingAccount ? "Wird gelöscht …" : "Endgültig löschen"}</button></details></article>
          <article className="privacy-card"><span>{cloudUser?.local ? "Lokale Entwicklung" : "Dein persönlicher Bereich"}</span><p>{cloudUser?.local ? "Auf localhost ist keine Anmeldung nötig. Die Daten bleiben in der lokalen Entwicklungsdatenbank und werden nicht mit einem Online-Account synchronisiert." : "Deine Finanzdaten werden deinem angemeldeten Account zugeordnet und zwischen deinen Geräten synchronisiert. Eine Bankverbindung ist nicht erforderlich."}</p></article>
        </section>}
      </div>

      <nav className="bottom-nav" aria-label="Mobile Hauptnavigation">
        <MobileNavButton icon="◉" label="Heute" active={activeView === "home"} onClick={() => navigate("home")} />
        <MobileNavButton icon="%" label="Monat" active={activeView === "month"} onClick={() => navigate("month")} />
        <MobileNavButton icon="↘" label="Kredite" active={activeView === "loans"} onClick={() => navigate("loans")} />
        <MobileNavButton icon="◇" label="Ziele" active={activeView === "goals"} onClick={() => navigate("goals")} />
        <MobileNavButton icon="●" label="Account" active={activeView === "more"} onClick={() => navigate("more")} />
      </nav>

      <footer><span>Njora</span><p>{cloudUser?.local ? "Lokal gespeichert · ohne Anmeldung" : "Persönlich synchronisiert · ohne Kontoanbindung"}</p><span>Verstehe, was war. Gestalte, was kommt.</span></footer>

      {showLegacyPrompt && legacyPlan && <div className="modal-backdrop"><section className="migration-card" role="dialog" aria-modal="true" aria-labelledby="migration-title"><span className="migration-icon">↗</span><p className="eyebrow">Lokale Daten gefunden</p><h2 id="migration-title">Gehört dieser Finanzplan dir?</h2><p>{cloudUser?.local ? "Auf diesem Gerät liegt ein früherer lokaler Plan. Du kannst ihn jetzt in die lokale Entwicklungsdatenbank übernehmen." : "Auf diesem Gerät liegt ein früherer lokaler Plan. Erst mit deiner Bestätigung wird er deinem persönlichen Account zugeordnet und online synchronisiert."}</p><div><button className="secondary-button" type="button" onClick={() => setShowLegacyPrompt(false)}>Neu beginnen</button><button className="primary-button" type="button" onClick={importLegacyPlan} disabled={syncStatus === "saving"}>Ja, sicher übernehmen <b>→</b></button></div><small>{cloudUser?.local ? "Nach der Übernahme werden die alten lokalen Browserschlüssel entfernt." : "Nach erfolgreicher Übernahme werden die alten lokalen Schlüssel entfernt."}</small></section></div>}

      {!plan && !showLegacyPrompt && <div className="modal-backdrop onboarding-backdrop"><section className="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="onboarding-top"><Brand /><span>Kurzer Fragebogen · etwa 3 Minuten</span></div>
        <div className="onboarding-progress-copy"><span>Schritt {onboardingStep + 1} von {onboardingSteps.length}</span><strong>{onboardingSteps[onboardingStep]}</strong></div>
        <div className="onboarding-progress" role="progressbar" aria-label="Fortschritt bei der Einrichtung" aria-valuemin={1} aria-valuemax={onboardingSteps.length} aria-valuenow={onboardingStep + 1}><i style={{ width: `${((onboardingStep + 1) / onboardingSteps.length) * 100}%` }} /></div>
        <ol className="onboarding-step-list" aria-label="Einrichtungsschritte">{onboardingSteps.map((step, index) => <li className={index === onboardingStep ? "active" : index < onboardingStep ? "done" : ""} key={step}><span>{index < onboardingStep ? "✓" : index + 1}</span><small>{step}</small></li>)}</ol>

        <form onSubmit={finishOnboarding} noValidate>
          <div className="onboarding-content">
            {onboardingStep === 0 && <>
              <p className="eyebrow">Willkommen bei Njora</p><h2 id="onboarding-title">Wie möchtest du deinen Finanzplan nennen?</h2><p className="onboarding-intro">Der Name erscheint nur in deinem persönlichen Bereich. Lege außerdem fest, wie oft du deine Kontostände prüfen möchtest.</p>
              <div className="onboarding-fields two"><label><FieldTitle required>Profilname</FieldTitle><input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="z. B. Mein Finanzplan" /></label><label><FieldTitle required>Check-in-Rhythmus</FieldTitle><select value={draft.checkInCadence} onChange={(e) => setDraft({ ...draft, checkInCadence: e.target.value as Plan["checkInCadence"] })}><option value="weekly">wöchentlich</option><option value="daily">täglich</option></select></label></div>
            </>}

            {onboardingStep === 1 && <>
              <p className="eyebrow">Konten & Karten</p><h2 id="onboarding-title">Wo liegt dein Geld heute?</h2><p className="onboarding-intro">Nur Name und aktueller Stand – eine Bankverbindung oder IBAN ist nicht nötig.</p>
              <div className="onboarding-list">{draft.accounts.map((item, index) => <div className="onboarding-row account" key={item.id}><label><FieldTitle required={index === 0}>Name</FieldTitle><input value={item.name} onChange={(e) => updateList("accounts", index, { name: e.target.value })} placeholder="z. B. Girokonto" /></label><label><FieldTitle>Aktueller Stand</FieldTitle><span className="currency-input"><input inputMode="decimal" value={item.balance || ""} onChange={(e) => updateList("accounts", index, { balance: numberValue(e.target.value) })} placeholder="0" /><b>€</b></span></label><label><FieldTitle required={index === 0}>Art</FieldTitle><select value={item.type} onChange={(e) => updateList("accounts", index, { type: e.target.value as Account["type"] })}><option value="bank">Konto</option><option value="credit">Kreditkarte</option><option value="cash">Bargeld</option></select></label><RemoveButton onClick={() => removeListItem("accounts", index)} /></div>)}</div>
              <AddButton onClick={() => setDraft({ ...draft, accounts: [...draft.accounts, { id: uid(), name: "", type: "bank", balance: 0 }] })}>Konto oder Karte</AddButton>
            </>}

            {onboardingStep === 2 && <>
              <p className="eyebrow">Monatliches Einkommen</p><h2 id="onboarding-title">Was kommt regelmäßig rein?</h2><p className="onboarding-intro">Ein monatlicher Betrag reicht für den Start. Weitere oder jährliche Einnahmen kannst du später ergänzen.</p>
              <div className="onboarding-list">{draft.incomes.filter((item) => !item.annual).map((item) => ({ item, index: draft.incomes.findIndex((entry) => entry.id === item.id) })).map(({ item, index }) => <div className="onboarding-row income" key={item.id}><label><FieldTitle required>Quelle</FieldTitle><input value={item.name} onChange={(e) => updateList("incomes", index, { name: e.target.value })} placeholder="z. B. Gehalt" /></label><label><FieldTitle required>Monatlicher Betrag</FieldTitle><span className="currency-input"><input inputMode="decimal" value={item.amount || ""} onChange={(e) => updateList("incomes", index, { amount: numberValue(e.target.value) })} placeholder="0" /><b>€</b></span></label><RemoveButton onClick={() => removeListItem("incomes", index)} /></div>)}</div>
              <AddButton onClick={() => setDraft({ ...draft, incomes: [...draft.incomes, { id: uid(), name: "", amount: 0, annual: false }] })}>Einkommensquelle</AddButton>
            </>}

            {onboardingStep === 3 && <>
              <p className="eyebrow">Monatliche Ausgaben</p><h2 id="onboarding-title">Was geht regelmäßig raus?</h2><p className="onboarding-intro">Dieser Schritt ist optional. Starte mit den größten Fixkosten; weitere Details kannst du jederzeit nachtragen.</p>
              <div className="optional-note"><b>Optional</b><span>Du kannst direkt weitergehen.</span></div>
              <div className="onboarding-list">{draft.expenses.map((item, index) => <div className="onboarding-row expense" key={item.id}><label><FieldTitle>Bezeichnung</FieldTitle><input value={item.name} onChange={(e) => updateList("expenses", index, { name: e.target.value })} placeholder="z. B. Miete" /></label><label><FieldTitle>Betrag</FieldTitle><span className="currency-input"><input inputMode="decimal" value={item.amount || ""} onChange={(e) => updateList("expenses", index, { amount: numberValue(e.target.value) })} placeholder="0" /><b>€</b></span></label><label><FieldTitle>Kategorie</FieldTitle><select value={item.category} onChange={(e) => updateList("expenses", index, { category: e.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label><RemoveButton onClick={() => removeListItem("expenses", index)} /></div>)}</div>
              <AddButton onClick={() => setDraft({ ...draft, expenses: [...draft.expenses, { id: uid(), name: "", amount: 0, category: "Wohnen", bookingDay: 0 }] })}>Ausgabe</AddButton>
            </>}

            {onboardingStep === 4 && <>
              <p className="eyebrow">Jahresplanung & Kredite</p><h2 id="onboarding-title">Gibt es größere Verpflichtungen?</h2><p className="onboarding-intro">Beides ist optional. Jahreskosten werden automatisch auf den Monat umgelegt; Kredite fließen mit ihrer Rate in deinen Spielraum ein.</p>
              <div className="onboarding-optional-groups"><section><div className="onboarding-group-head"><div><strong>Jährliche Ausgaben</strong><small>Optional</small></div><AddButton onClick={() => setDraft({ ...draft, annualCosts: [...draft.annualCosts, { id: uid(), name: "", amount: 0, month: 0 }] })}>Jahreskosten</AddButton></div>{draft.annualCosts.map((item, index) => <div className="onboarding-row annual" key={item.id}><input aria-label="Jahreskosten" value={item.name} onChange={(e) => updateList("annualCosts", index, { name: e.target.value })} placeholder="z. B. KFZ-Steuer" /><span className="currency-input"><input aria-label="Jahresbetrag" inputMode="decimal" value={item.amount || ""} onChange={(e) => updateList("annualCosts", index, { amount: numberValue(e.target.value) })} placeholder="pro Jahr" /><b>€</b></span><select aria-label="Fälligkeitsmonat" value={item.month} onChange={(e) => updateList("annualCosts", index, { month: Number(e.target.value) })}>{months.map((month, monthIndex) => <option value={monthIndex} key={month}>{month}</option>)}</select><RemoveButton onClick={() => removeListItem("annualCosts", index)} /></div>)}</section>
              <section><div className="onboarding-group-head"><div><strong>Kredite & Verpflichtungen</strong><small>Optional</small></div><AddButton onClick={() => setDraft({ ...draft, commitments: [...draft.commitments, { id: uid(), name: "", balance: 0, payment: 0, interestRate: 0, termMonths: 0, extraPayment: 0 }] })}>Kredit</AddButton></div>{draft.commitments.map((item, index) => <div className="onboarding-row loan" key={item.id}><input aria-label="Kreditname" value={item.name} onChange={(e) => updateList("commitments", index, { name: e.target.value })} placeholder="z. B. Autokredit" /><span className="currency-input"><input aria-label="Restschuld" inputMode="decimal" value={item.balance || ""} onChange={(e) => updateList("commitments", index, { balance: numberValue(e.target.value) })} placeholder="Restschuld" /><b>€</b></span><span className="currency-input"><input aria-label="Monatsrate" inputMode="decimal" value={item.payment || ""} onChange={(e) => updateList("commitments", index, { payment: numberValue(e.target.value) })} placeholder="Monatsrate" /><b>€</b></span><RemoveButton onClick={() => removeListItem("commitments", index)} /></div>)}</section></div>
            </>}

            {onboardingStep === 5 && <>
              <p className="eyebrow">Ziele & Abschluss</p><h2 id="onboarding-title">Wofür möchtest du Raum schaffen?</h2><p className="onboarding-intro">Ziele sind optional. Danach ist dein Finanzplan bereit; Ersparnisse und Wertpapiere kannst du später in Ruhe ergänzen.</p>
              <div className="optional-note"><b>Optional</b><span>Ohne Ziel kannst du die Einrichtung direkt abschließen.</span></div>
              <div className="onboarding-list">{draft.goals.map((item, index) => <div className="onboarding-row goal" key={item.id}><label><FieldTitle>Ziel</FieldTitle><input value={item.name} onChange={(e) => updateList("goals", index, { name: e.target.value })} placeholder="z. B. Notgroschen" /></label><label><FieldTitle>Zielbetrag</FieldTitle><span className="currency-input"><input inputMode="decimal" value={item.target || ""} onChange={(e) => updateList("goals", index, { target: numberValue(e.target.value) })} placeholder="0" /><b>€</b></span></label><label><FieldTitle>Schon gespart</FieldTitle><span className="currency-input"><input inputMode="decimal" value={item.saved || ""} onChange={(e) => updateList("goals", index, { saved: numberValue(e.target.value) })} placeholder="0" /><b>€</b></span></label><RemoveButton onClick={() => removeListItem("goals", index)} /></div>)}</div>
              <AddButton onClick={() => setDraft({ ...draft, goals: [...draft.goals, { id: uid(), name: "", target: 0, saved: 0, monthly: 0, targetDate: "" }] })}>Ziel</AddButton>
              <div className="onboarding-summary"><span>✓</span><div><strong>Deine Übersicht ist gleich bereit.</strong><p>{draft.accounts.filter((item) => item.name.trim()).length} Konten/Karten · {draft.incomes.filter((item) => !item.annual && item.amount > 0).length} Einkommen · {draft.expenses.filter((item) => item.amount > 0).length} Ausgaben</p></div></div>
            </>}
          </div>

          {onboardingError && <p className="onboarding-error" role="alert">{onboardingError}</p>}
          <div className="onboarding-actions"><button className="secondary-button" type="button" onClick={previousOnboardingStep} disabled={onboardingStep === 0}>Zurück</button><span>{syncStatus === "saving" ? "Wird sicher gespeichert …" : onboardingStep < onboardingSteps.length - 1 ? "Du kannst Angaben später ändern." : "Bereit für deinen Überblick."}</span><button className="primary-button" type="submit" disabled={syncStatus === "saving"}>{onboardingStep < onboardingSteps.length - 1 ? <>Weiter <b>→</b></> : <>Njora starten <b>→</b></>}</button></div>
        </form>
      </section></div>}

      {editing && plan && !showLegacyPrompt && <div className="modal-backdrop"><section className={`editor-card ${editorScope ? "focused-editor" : ""}`} role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <div className="editor-header"><div><p className="eyebrow">{currentEditorCopy?.eyebrow ?? "Dein lokaler Finanzplan"}</p><h2 id="editor-title">{currentEditorCopy?.title ?? (plan ? "Plan bearbeiten" : "Lass uns Klarheit schaffen.")}</h2></div>{plan && <button type="button" className="close-button" onClick={closeEditor} aria-label="Schließen">×</button>}</div>
        <p className="editor-intro">{currentEditorCopy?.intro ?? "Richte deinen Alltag einmal ein. Danach reichen kurze Check-ins, um jederzeit ein klares Bild zu haben."}</p>
        <form onSubmit={savePlan}>
          {!editorScope && <div className="editor-section basis-grid"><label>Profilname<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="z. B. Mein Budget" required /></label><label>Check-in-Rhythmus<select value={draft.checkInCadence} onChange={(e) => setDraft({ ...draft, checkInCadence: e.target.value as Plan["checkInCadence"] })}><option value="daily">täglich</option><option value="weekly">wöchentlich</option></select></label></div>}

          {(!editorScope || editorScope === "accounts") && <EditorSection id="editor-accounts" title="Konten & Karten" subtitle="Nur der aktuelle Stand – keine Bankverbindung nötig">
            {draft.accounts.map((item, index) => <div className="editor-row four" key={item.id}><input aria-label="Kontoname" value={item.name} onChange={(e) => updateList("accounts", index, { name: e.target.value })} placeholder="z. B. Girokonto" /><input aria-label="Aktueller Stand" inputMode="decimal" value={item.balance || ""} onChange={(e) => updateList("accounts", index, { balance: numberValue(e.target.value) })} placeholder="Stand" /><select aria-label="Kontotyp" value={item.type} onChange={(e) => updateList("accounts", index, { type: e.target.value as Account["type"] })}><option value="bank">Konto</option><option value="credit">Kreditkarte</option><option value="cash">Bargeld</option></select><RemoveButton onClick={() => removeListItem("accounts", index)} /></div>)}
            <AddButton onClick={() => setDraft({ ...draft, accounts: [...draft.accounts, { id: uid(), name: "", type: "bank", balance: 0 }] })}>Konto oder Karte</AddButton>
          </EditorSection>}

          {(!editorScope || editorScope === "income") && <EditorSection id="editor-income" title="Einkommen" subtitle="Monatlich und jährlich getrennt">
            {draft.incomes.map((item, index) => <div className="editor-row income-edit" key={item.id}><input aria-label="Einkommensquelle" value={item.name} onChange={(e) => updateList("incomes", index, { name: e.target.value })} placeholder="z. B. Gehalt" /><input aria-label="Betrag" inputMode="decimal" value={item.amount || ""} onChange={(e) => updateList("incomes", index, { amount: numberValue(e.target.value) })} placeholder="Betrag" /><select aria-label="Rhythmus" value={item.annual ? "annual" : "monthly"} onChange={(e) => updateList("incomes", index, { annual: e.target.value === "annual", month: e.target.value === "annual" ? item.month : undefined })}><option value="monthly">monatlich</option><option value="annual">jährlich</option></select><select aria-label="Eingangsmonat" disabled={!item.annual} value={item.annual ? item.month ?? "" : ""} onChange={(e) => updateList("incomes", index, { month: e.target.value === "" ? undefined : Number(e.target.value) })}><option value="">{item.annual ? "Monat wählen" : "jeden Monat"}</option>{months.map((month, monthIndex) => <option value={monthIndex} key={month}>{month}</option>)}</select><RemoveButton onClick={() => removeListItem("incomes", index)} /></div>)}
            <AddButton onClick={() => setDraft({ ...draft, incomes: [...draft.incomes, { id: uid(), name: "", amount: 0, annual: false }] })}>Einkommensquelle</AddButton>
          </EditorSection>}

          {editorScope === "specials" && <EditorSection id="editor-special-income" title="Jährliche Einnahmen" subtitle="Bonus, Weihnachtsgeld und andere planbare Sonderzuflüsse">
            {draft.incomes.map((item, index) => ({ item, index })).filter(({ item }) => item.annual).map(({ item, index }) => <div className="editor-row four" key={item.id}><input aria-label="Jährliche Einnahme" value={item.name} onChange={(e) => updateList("incomes", index, { name: e.target.value })} placeholder="z. B. Weihnachtsgeld" /><input aria-label="Betrag der jährlichen Einnahme" inputMode="decimal" value={item.amount || ""} onChange={(e) => updateList("incomes", index, { amount: numberValue(e.target.value) })} placeholder="Betrag" /><select aria-label="Eingangsmonat" value={item.month ?? ""} onChange={(e) => updateList("incomes", index, { month: e.target.value === "" ? undefined : Number(e.target.value) })}><option value="">Monat wählen</option>{months.map((month, monthIndex) => <option value={monthIndex} key={month}>{month}</option>)}</select><RemoveButton onClick={() => removeListItem("incomes", index)} /></div>)}
            <AddButton onClick={() => setDraft({ ...draft, incomes: [...draft.incomes, { id: uid(), name: "", amount: 0, annual: true, month: currentMonth }] })}>Jährliche Einnahme</AddButton>
          </EditorSection>}

          {(!editorScope || editorScope === "expenses") && <EditorSection id="editor-expenses" title="Monatliche Ausgaben" subtitle="Nach Lebensbereichen statt als ein großer Block">
            {editorTarget && !editorTarget.startsWith("item:") && <div className="category-color-editor"><div><span className="category-color-preview" style={{ backgroundColor: draft.categoryColors[editorTarget] ?? defaultCategoryColors[editorTarget] }} /><span><strong>Kategoriefarbe</strong><small>Für Diagramm und Monatsübersicht</small></span></div><label><input aria-label={`Farbe für ${editorTarget}`} type="color" value={draft.categoryColors[editorTarget] ?? defaultCategoryColors[editorTarget]} onChange={(e) => setDraft({ ...draft, categoryColors: { ...draft.categoryColors, [editorTarget]: e.target.value } })} /></label></div>}
            {draft.expenses.map((item, index) => ({ item, index })).filter(({ item }) => !editorTarget || (editorTarget.startsWith("item:") ? item.id === editorTarget.slice(5) : item.category === editorTarget)).map(({ item, index }) => <div className="editor-row expense-edit" key={item.id}><input aria-label="Ausgabe" value={item.name} onChange={(e) => updateList("expenses", index, { name: e.target.value })} placeholder="z. B. Miete" /><input aria-label="Monatsbetrag" inputMode="decimal" value={item.amount || ""} onChange={(e) => updateList("expenses", index, { amount: numberValue(e.target.value) })} placeholder="monatlich" /><select aria-label="Kategorie" value={item.category} disabled={Boolean(editorTarget && !editorTarget.startsWith("item:"))} onChange={(e) => updateList("expenses", index, { category: e.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select><input aria-label="Buchungstag" type="number" min="1" max="31" value={item.bookingDay || ""} onChange={(e) => updateList("expenses", index, { bookingDay: Math.min(Math.max(numberValue(e.target.value), 0), 31) })} placeholder="Tag optional" /><RemoveButton onClick={() => removeListItem("expenses", index)} /></div>)}
            {!editorTarget?.startsWith("item:") && <AddButton onClick={() => setDraft({ ...draft, expenses: [...draft.expenses, { id: uid(), name: "", amount: 0, category: editorTarget && categories.includes(editorTarget) ? editorTarget : "Wohnen", bookingDay: 0 }] })}>Ausgabe</AddButton>}
          </EditorSection>}

          {(!editorScope || editorScope === "annual" || editorScope === "specials") && <EditorSection id="editor-annual" title="Jährliche Ausgaben" subtitle="Fälligkeit sichtbar, Rücklage automatisch">
            {draft.annualCosts.map((item, index) => <div className="editor-row four" key={item.id}><input aria-label="Jahreskosten" value={item.name} onChange={(e) => updateList("annualCosts", index, { name: e.target.value })} placeholder="z. B. KFZ-Steuer" /><input aria-label="Jahresbetrag" inputMode="decimal" value={item.amount || ""} onChange={(e) => updateList("annualCosts", index, { amount: numberValue(e.target.value) })} placeholder="pro Jahr" /><select aria-label="Fällig im Monat" value={item.month} onChange={(e) => updateList("annualCosts", index, { month: Number(e.target.value) })}>{months.map((month, monthIndex) => <option value={monthIndex} key={month}>{month}</option>)}</select><RemoveButton onClick={() => removeListItem("annualCosts", index)} /></div>)}
            <AddButton onClick={() => setDraft({ ...draft, annualCosts: [...draft.annualCosts, { id: uid(), name: "", amount: 0, month: editorScope === "specials" ? currentMonth : 0 }] })}>Jahreskosten</AddButton>
          </EditorSection>}

          {(!editorScope || editorScope === "loans") && <EditorSection id="editor-loans" title="Kredite & Verpflichtungen" subtitle="Restschuld und Rate reichen aus; Vertragsdetails verbessern die Prognose">
            {draft.commitments.map((item, index) => ({ item, index })).filter(({ item }) => !editorTarget || item.id === editorTarget).map(({ item, index }) => <div className="loan-editor-item" key={item.id}><div className="editor-row four"><input aria-label="Verpflichtung" value={item.name} onChange={(e) => updateList("commitments", index, { name: e.target.value })} placeholder="z. B. Immobilienkredit" /><input aria-label="Restbetrag" inputMode="decimal" value={item.balance || ""} onChange={(e) => updateList("commitments", index, { balance: numberValue(e.target.value) })} placeholder="Restschuld" /><input aria-label="Monatsrate" inputMode="decimal" value={item.payment || ""} onChange={(e) => updateList("commitments", index, { payment: numberValue(e.target.value) })} placeholder="Monatsrate" /><RemoveButton onClick={() => removeListItem("commitments", index)} /></div><details className="loan-details" open={Boolean(item.interestRate || item.termMonths || item.extraPayment)}><summary>Optionale Vertragsdetails für genauere Prognose</summary><div><label>Zinssatz p. a.<span className="currency-input"><input aria-label="Zinssatz pro Jahr" inputMode="decimal" value={item.interestRate || ""} onChange={(e) => updateList("commitments", index, { interestRate: numberValue(e.target.value) })} placeholder="z. B. 3,5" /><b>%</b></span></label><label>Restlaufzeit<span className="currency-input"><input aria-label="Restlaufzeit in Monaten" inputMode="numeric" value={item.termMonths || ""} onChange={(e) => updateList("commitments", index, { termMonths: numberValue(e.target.value) })} placeholder="Monate" /><b>M</b></span></label><label>Zusätzliche Monatsrate<span className="currency-input"><input aria-label="Zusätzliche monatliche Tilgung" inputMode="decimal" value={item.extraPayment || ""} onChange={(e) => updateList("commitments", index, { extraPayment: numberValue(e.target.value) })} placeholder="optional" /><b>€</b></span></label></div></details></div>)}
            {!editorTarget && <AddButton onClick={() => setDraft({ ...draft, commitments: [...draft.commitments, { id: uid(), name: "", balance: 0, payment: 0, interestRate: 0, termMonths: 0, extraPayment: 0 }] })}>Kredit oder Verpflichtung</AddButton>}
          </EditorSection>}

          {(!editorScope || editorScope === "goals") && <EditorSection id="editor-goals" title="Ziele" subtitle="Zieldatum optional – Ziele werden nur aus deinem Überschuss bedient">
            {draft.goals.map((item, index) => ({ item, index })).filter(({ item }) => !editorTarget || item.id === editorTarget).map(({ item, index }) => <div className="editor-row five" key={item.id}><input aria-label="Ziel" value={item.name} onChange={(e) => updateList("goals", index, { name: e.target.value })} placeholder="z. B. Notgroschen" /><input aria-label="Zielbetrag" inputMode="decimal" value={item.target || ""} onChange={(e) => updateList("goals", index, { target: numberValue(e.target.value) })} placeholder="Zielbetrag" /><input aria-label="Schon gespart" inputMode="decimal" value={item.saved || ""} onChange={(e) => updateList("goals", index, { saved: numberValue(e.target.value) })} placeholder="Schon gespart" /><input aria-label="Optionales Zieldatum" type="date" value={item.targetDate || ""} onChange={(e) => updateList("goals", index, { targetDate: e.target.value })} /><RemoveButton onClick={() => removeListItem("goals", index)} /></div>)}
            {!editorTarget && <AddButton onClick={() => setDraft({ ...draft, goals: [...draft.goals, { id: uid(), name: "", target: 0, saved: 0, monthly: 0, targetDate: "" }] })}>Ziel</AddButton>}
          </EditorSection>}

          {(!editorScope || editorScope === "savings") && <EditorSection id="editor-savings" title="Depot & Ersparnisse" subtitle="Wertpapiere automatisch bewerten, andere Rücklagen manuell pflegen">
            {draft.savings.map((item, index) => ({ item, index })).filter(({ item }) => !editorTarget || item.id === editorTarget).map(({ item, index }) => <div className="saving-editor-item" key={item.id}>
              <div className={`editor-row ${item.kind === "security" ? "saving-security-edit" : "saving-balance-edit"}`}>
                {item.kind === "security" ? <SecurityAutocomplete id={item.id} value={item.name} onChange={(value) => updateList("savings", index, { name: value })} onSelect={(suggestion) => updateList("savings", index, { name: suggestion.name, symbol: suggestion.symbol, price: 0, priceEur: 0, currency: "EUR", quoteUpdatedAt: undefined })} /> : <input aria-label="Bezeichnung der Ersparnis" value={item.name} onChange={(e) => updateList("savings", index, { name: e.target.value })} placeholder="z. B. Notgroschen" />}
                <select aria-label="Art der Ersparnis" value={item.kind} onChange={(e) => updateList("savings", index, { kind: e.target.value as SavingKind })}>{Object.entries(savingKindLabels).map(([kind, label]) => <option value={kind} key={kind}>{label}</option>)}</select>
                {item.kind === "security" ? <>
                  <input aria-label="Börsensymbol" value={item.symbol ?? ""} onChange={(e) => updateList("savings", index, { symbol: e.target.value.toUpperCase() })} placeholder="Symbol, z. B. SAP.DE" autoCapitalize="characters" />
                  <input aria-label="Stückzahl" inputMode="decimal" value={item.quantity || ""} onChange={(e) => updateList("savings", index, { quantity: Math.max(numberValue(e.target.value), 0) })} placeholder="Stückzahl" />
                  <span className="currency-input"><input aria-label="Kurs in Euro" inputMode="decimal" value={item.priceEur || ""} onChange={(e) => updateList("savings", index, { priceEur: Math.max(numberValue(e.target.value), 0), price: Math.max(numberValue(e.target.value), 0), currency: "EUR", quoteUpdatedAt: undefined })} placeholder="Kurs in EUR" /><b>€</b></span>
                </> : <span className="currency-input"><input aria-label="Aktueller Sparstand" inputMode="decimal" value={item.balance || ""} onChange={(e) => updateList("savings", index, { balance: Math.max(numberValue(e.target.value), 0) })} placeholder="Aktueller Stand" /><b>€</b></span>}
                <RemoveButton onClick={() => removeListItem("savings", index)} />
              </div>
              {item.kind === "security" && <div className="saving-quote-hint"><span>Aktueller Wert <b>{euro(savingValue(item))}</b></span><small>{item.quoteUpdatedAt ? `${marketPrice(item.price ?? 0, item.currency)} · Kurs vom ${dateTimeLabel(item.quoteUpdatedAt)}` : item.symbol ? `${item.symbol} automatisch gewählt · Kurs nach dem Speichern aktualisierbar` : "Unternehmen suchen und aus der Liste auswählen"}</small></div>}
            </div>)}
            {!editorTarget && <div className="saving-add-actions"><AddButton onClick={() => setDraft({ ...draft, savings: [...draft.savings, { id: uid(), name: "", kind: "security", balance: 0, symbol: "", quantity: 0, price: 0, priceEur: 0, currency: "EUR" }] })}>Wertpapier</AddButton><AddButton onClick={() => setDraft({ ...draft, savings: [...draft.savings, { id: uid(), name: "", kind: "dayMoney", balance: 0 }] })}>Sparform</AddButton></div>}
          </EditorSection>}

          {!editorScope && <details className="data-import"><summary>Daten aus einer Njora-Sicherung importieren</summary><textarea aria-label="Njora-Daten" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Njora-JSON hier einfügen" /><button type="button" onClick={importPlan}>Sicherung importieren</button></details>}

          <div className="editor-actions"><span>{syncStatus === "saving" ? "Wird sicher gespeichert …" : cloudUser?.local ? "Lokal gespeichert · ohne Anmeldung" : "Persönlich synchronisiert · ohne Kontoanbindung"}</span><button className="primary-button" type="submit" disabled={syncStatus === "saving"}>{editorScope ? "Änderungen speichern" : "Übersicht speichern"} <b>→</b></button></div>
        </form>
      </section></div>}

      {savingsOpen && <div className="modal-backdrop"><section className="savings-card" role="dialog" aria-modal="true" aria-labelledby="savings-title">
        <div className="editor-header"><div><p className="eyebrow">Vermögen & Depot</p><h2 id="savings-title">Deine Ersparnisse</h2></div><button type="button" className="close-button" onClick={() => setSavingsOpen(false)} aria-label="Schließen">×</button></div>
        <div className="savings-total"><span>Gesamtwert</span><strong>{euro(savingsMetrics.total)}</strong><small>Getrennt vom Kontostand und Monatsforecast</small></div>
        <div className="savings-toolbar"><button className="secondary-button" type="button" onClick={refreshQuotes} disabled={quoteStatus === "loading"}>{quoteStatus === "loading" ? "Kurse werden geladen …" : "Wertpapierkurse aktualisieren"}</button><div><button type="button" onClick={() => openFocusedEditor("savings", "security")}>+ Wertpapier</button><button type="button" onClick={() => openFocusedEditor("savings", "saving")}>+ Sparform</button></div></div>
        {quoteMessage && <p className={`quote-status ${quoteStatus}`} role="status">{quoteMessage}</p>}
        <div className="savings-list">{savingsMetrics.items.length ? savingsMetrics.items.map((item) => <article key={item.id}>
          <i style={{ backgroundColor: savingKindColors[item.kind] }} />
          <div><strong>{item.name || savingKindLabels[item.kind]}</strong><small>{item.kind === "security" ? `${item.symbol || "Symbol fehlt"} · ${item.quantity || 0} Stück${item.quoteUpdatedAt ? ` · ${marketPrice(item.price ?? 0, item.currency)}` : ""}` : savingKindLabels[item.kind]}</small></div>
          <span><b>{euro(item.value)}</b><small>{savingsMetrics.total ? `${Math.round((item.value / savingsMetrics.total) * 100)}%` : "0%"}</small></span>
          <button className="edit-chip" type="button" onClick={() => openFocusedEditor("savings", undefined, item.id)}>Ändern</button>
        </article>) : <div className="savings-empty"><span>◇</span><strong>Noch keine Ersparnisse erfasst</strong><p>Füge dein erstes Wertpapier, Tagesgeldkonto oder eine andere Rücklage hinzu.</p></div>}</div>
        <p className="market-note">Marktwerte sind unverbindliche Näherungen und können verzögert sein. Suchbegriffe und Börsensymbole werden für Suche und Kursabgleich an Yahoo Finance übertragen. Keine Anlageberatung.</p>
      </section></div>}

      {checkingIn && <div className="modal-backdrop"><section className="checkin-card" role="dialog" aria-modal="true" aria-labelledby="checkin-title">
        <div className="editor-header"><div><p className="eyebrow">Konten & Karten</p><h2 id="checkin-title">Stände aktualisieren</h2></div><button type="button" className="close-button" onClick={() => setCheckingIn(false)} aria-label="Schließen">×</button></div>
        <p className="editor-intro">Passe Konten, Karten und Beträge direkt an. Mit dem Speichern wird zugleich dein aktueller Check-in erfasst.</p>
        <form onSubmit={saveCheckIn}>
          <label>Stand vom<input type="date" value={checkInDate} onChange={(e) => setCheckInDate(e.target.value)} required /></label>
          <div className="checkin-accounts">{checkInAccounts.map((account, index) => <div className="checkin-account-edit" key={account.id}><input aria-label="Kontoname" value={account.name} onChange={(e) => setCheckInAccounts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: e.target.value } : item))} placeholder="Kontoname" /><select aria-label={`Typ von ${account.name || "Konto"}`} value={account.type} onChange={(e) => setCheckInAccounts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, type: e.target.value as Account["type"] } : item))}><option value="bank">Konto</option><option value="credit">Kreditkarte</option><option value="cash">Bargeld</option></select><span className="currency-input"><input aria-label={`Stand von ${account.name || "Konto"}`} inputMode="decimal" value={account.balance || ""} onChange={(e) => setCheckInAccounts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, balance: numberValue(e.target.value) } : item))} placeholder="Stand" /><b>€</b></span>{checkInAccounts.length > 1 && <RemoveButton onClick={() => setCheckInAccounts((current) => current.filter((_, itemIndex) => itemIndex !== index))} />}</div>)}<button className="account-add-line" type="button" onClick={() => setCheckInAccounts((current) => [...current, { id: uid(), name: "", type: "bank", balance: 0 }])}><span>+</span> Konto oder Karte hinzufügen</button></div>
          <label>Notiz (optional)<input value={checkInNote} onChange={(e) => setCheckInNote(e.target.value)} placeholder="z. B. Kreditkarte bereits ausgeglichen" /></label>
          <div className="checkin-preview"><span>Netto-Stand nach diesem Update</span><strong>{euro(checkInAccounts.reduce((sum, account) => sum + (account.type === "credit" ? -account.balance : account.balance), 0))}</strong></div>
          <button className="primary-button wide" type="submit">Stand speichern <b>→</b></button>
        </form>
      </section></div>}
    </main>
  );
}

function SecurityAutocomplete({ id, value, onChange, onSelect }: { id: string; value: string; onChange: (value: string) => void; onSelect: (suggestion: SecuritySuggestion) => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [suggestions, setSuggestions] = useState<SecuritySuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = `security-suggestions-${id}`;

  useEffect(() => {
    const query = value.trim();
    if (!open || query.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/market/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("search failed");
        const result = await response.json() as { suggestions?: SecuritySuggestion[] };
        const nextSuggestions = result.suggestions ?? [];
        setSuggestions(nextSuggestions);
        setActiveIndex(nextSuggestions.length ? 0 : -1);
      } catch (searchError) {
        if ((searchError as Error).name !== "AbortError") {
          setSuggestions([]);
          setError(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 240);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, value]);

  function choose(suggestion: SecuritySuggestion) {
    setOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);
    onSelect(suggestion);
  }

  return <div className="security-search-field">
    <input
      role="combobox"
      aria-label="Aktie oder ETF suchen"
      aria-autocomplete="list"
      aria-expanded={open && value.trim().length >= 2}
      aria-controls={listId}
      aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
      value={value}
      onChange={(event) => {
        const nextValue = event.target.value;
        onChange(nextValue);
        setOpen(true);
        if (nextValue.trim().length < 2) { setSuggestions([]); setLoading(false); setError(false); setActiveIndex(-1); }
        else { setLoading(true); setError(false); }
      }}
      onFocus={() => { setOpen(true); if (value.trim().length >= 2) { setLoading(true); setError(false); } }}
      onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" && suggestions.length) { event.preventDefault(); setActiveIndex((current) => Math.min(current + 1, suggestions.length - 1)); }
        if (event.key === "ArrowUp" && suggestions.length) { event.preventDefault(); setActiveIndex((current) => Math.max(current - 1, 0)); }
        if (event.key === "Enter" && activeIndex >= 0) { event.preventDefault(); choose(suggestions[activeIndex]); }
        if (event.key === "Escape") setOpen(false);
      }}
      placeholder="Aktie oder ETF suchen"
      autoComplete="off"
    />
    {open && value.trim().length >= 2 && <div className="security-suggestions" id={listId} role="listbox">
      {loading ? <p>Wertpapiere werden gesucht …</p> : error ? <p>Suche gerade nicht erreichbar</p> : suggestions.length ? suggestions.map((suggestion, index) => <button
        id={`${listId}-${index}`}
        className={activeIndex === index ? "active" : ""}
        type="button"
        role="option"
        aria-selected={activeIndex === index}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => choose(suggestion)}
        key={`${suggestion.symbol}-${suggestion.exchange}`}
      ><span>{suggestion.name.charAt(0).toUpperCase()}</span><div><strong>{suggestion.name}</strong><small>Handelsplatz wird automatisch gewählt</small></div><b>{suggestion.type}</b></button>) : <p>Kein passendes Wertpapier gefunden</p>}
    </div>}
  </div>;
}

function Brand() {
  return <span className="brand-lockup" role="img" aria-label="Njora"><img className="brand-mark" src="/njora-mark.png" width="42" height="42" alt="" /><img className="brand-wordmark" src="/njora-wordmark.png" width="112" height="35" alt="" /></span>;
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={active ? "active" : ""} type="button" onClick={onClick}>{children}</button>;
}

function MobileNavButton({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return <button aria-label={label} className={active ? "active" : ""} type="button" onClick={onClick}><span aria-hidden="true">{icon}</span><small>{label}</small></button>;
}

function ViewHeader({ id, eyebrow, title, copy }: { id: string; eyebrow: string; title: string; copy: string }) {
  return <header className="view-header"><p className="eyebrow">{eyebrow}</p><h1 id={id}>{title}</h1><p>{copy}</p></header>;
}

function SummaryCard({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return <article className={`summary-card ${tone}`}><span>{label}</span><strong>{euro(value)}</strong></article>;
}

function EditorSection({ id, title, subtitle, children }: { id?: string; title: string; subtitle: string; children: React.ReactNode }) {
  return <section id={id} className="editor-section"><div className="editor-section-head"><div><h3>{title}</h3><p>{subtitle}</p></div></div>{children}</section>;
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
