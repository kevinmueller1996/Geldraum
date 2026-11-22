"use client";

import { useEffect, useRef, useState } from "react";
import { acceptsAmountEdit, parseAmount } from "./amount";
import { revenueMonthLabel, revenueStats } from "./check-in";
import type { Plan } from "./page";

const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
type Props = {
  plan: Plan;
  today: string;
  save: (next: Plan, base: Plan) => Promise<boolean>;
  problem: string;
};

export default function RevenueHistory({ plan, today, save, problem }: Props) {
  const stats = revenueStats(plan.monthlyRevenue ?? {}, today);
  const [edit, setEdit] = useState<{ month: string; base: Plan } | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (edit && !dialog.current?.open) dialog.current?.showModal();
  }, [edit]);

  function selectMonth(month: string, base: Plan) {
    setEdit({ month, base });
    setDraft(base.monthlyRevenue?.[month]?.toString().replace(".", ",") ?? "");
    setFailed(false);
  }
  function close() {
    dialog.current?.close();
    setEdit(null);
  }
  const amount = draft.trim() ? parseAmount(draft) : null;
  const validMonth = edit && /^\d{4}-(0[1-9]|1[0-2])$/.test(edit.month) && edit.month >= "0001-01" && edit.month <= stats.months[0];
  function row(month: string) {
    const value = plan.monthlyRevenue?.[month];
    const range = stats.max - stats.min || 1;
    return <button key={month} className="revenue-row" type="button" onClick={() => selectMonth(month, plan)}>
      <span>{revenueMonthLabel(month)}</span>
      <span className="revenue-track" aria-hidden="true">
        {value !== undefined && value !== 0 && <i style={{ left: ((Math.min(value, 0) - stats.min) / range * 100) + "%", width: (Math.abs(value) / range * 100) + "%" }} />}
      </span>
      <strong>{value === undefined ? "Nachtragen" : money.format(value)}</strong>
    </button>;
  }
  const older = Object.keys(plan.monthlyRevenue ?? {}).filter(month => month < stats.months[11]).sort().reverse();
  return <section className="view" aria-labelledby="revenue-heading">
    <div className="section-title financial-heading"><h1 id="revenue-heading">Umsatz</h1><button className="edit-chip" type="button" onClick={() => selectMonth(stats.months.find(m => plan.monthlyRevenue?.[m] === undefined) ?? stats.months[0], plan)}>Monat nachtragen</button></div>
    <article className="detail-card">
      <h2>Letzte 12 abgeschlossene Monate</h2>
      <p>{stats.count} von 12 Monaten erfasst</p>
      <div className="detail-row"><span>Nettoumsatz gesamt</span><b>{stats.count ? money.format(stats.total) : "–"}</b></div>
      <div className="detail-row"><span>Ø je erfasstem Monat</span><b>{stats.count ? money.format(stats.total / stats.count) : "–"}</b></div>
      <div className="revenue-rows">{stats.months.map(row)}</div>
    </article>
    {older.length > 0 && <details className="detail-card"><summary>Frühere Monate ({older.length})</summary>{older.map(month =>
      <button className="revenue-row" type="button" key={month} onClick={() => selectMonth(month, plan)}><span>{revenueMonthLabel(month)}</span><span /><strong>{money.format(plan.monthlyRevenue![month])}</strong></button>)}</details>}
    {edit && <dialog ref={dialog} className="revenue-dialog" aria-labelledby="revenue-editor-title" onCancel={e => { e.preventDefault(); if (!saving) close(); }}>
      <form onSubmit={async e => {
        e.preventDefault();
        if (!validMonth || amount === null || saving) return;
        setSaving(true);
        const ok = await save({ ...edit.base, monthlyRevenue: { ...edit.base.monthlyRevenue, [edit.month]: amount } }, edit.base);
        setSaving(false);
        if (ok) close(); else setFailed(true);
      }}>
        <h2 id="revenue-editor-title">Monatsumsatz</h2>
        <label>Monat<input type="month" required min="0001-01" max={stats.months[0]} value={edit.month} onChange={e => selectMonth(e.target.value, edit.base)} disabled={saving} /></label>
        <label>Nettoumsatz (€)<input autoFocus inputMode="decimal" placeholder="0,00" required value={draft} onChange={e => { if (acceptsAmountEdit(e.target.value)) setDraft(e.target.value); }} disabled={saving} /></label>
        {failed && <p role="alert">{problem || "Der Umsatz konnte nicht gespeichert werden."}</p>}
        <div><button type="button" onClick={close} disabled={saving}>Abbrechen</button><button className="primary-button" disabled={!validMonth || amount === null || saving}>Speichern</button></div>
      </form>
    </dialog>}
  </section>;
}
