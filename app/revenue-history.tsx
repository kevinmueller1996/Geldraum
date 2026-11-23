"use client";

import { useEffect, useRef, useState } from "react";
import { RevenueFields } from "./revenue-fields";
import { revenueAmounts, revenueDraft, revenueValue, withRevenue } from "./revenue-vat";
import type { VatBasis } from "./recurring-costs";
import { revenueMonthLabel, revenueStats } from "./check-in";
import type { Plan } from "./page";

const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
type Props = {
  plan: Plan;
  today: string;
  save: (next: Plan, base: Plan) => Promise<boolean>;
  problem: string;
  basis: VatBasis;
  readOnly?: boolean;
};

export default function RevenueHistory({ plan, today, save, problem, basis, readOnly=false }: Props) {
  const values = Object.fromEntries(Object.keys(plan.monthlyRevenue ?? {}).flatMap(month => {
    const value = revenueValue(plan, month, basis);
    return value === undefined ? [] : [[month, value]];
  }));
  const stats = revenueStats(values, today);
  const missing = stats.months.filter(month => plan.monthlyRevenue?.[month] !== undefined && values[month] === undefined).length;
  const [edit, setEdit] = useState<{ month: string; base: Plan } | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => revenueDraft({}, ""));
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (edit && !dialog.current?.open) dialog.current?.showModal();
  }, [edit]);

  function selectMonth(month: string, base: Plan) {
    setEdit({ month, base });
    setDraft(revenueDraft(base, month));
    setFailed(false);
  }
  function close() {
    dialog.current?.close();
    setEdit(null);
  }
  const amount = revenueAmounts(draft);
  const validMonth = edit && /^\d{4}-(0[1-9]|1[0-2])$/.test(edit.month) && edit.month >= "0001-01" && edit.month <= stats.months[0];
  function row(month: string) {
    const value = values[month];
    const range = stats.max - stats.min || 1;
    return <button key={month} className="revenue-row" type="button" disabled={readOnly} onClick={() => selectMonth(month, plan)}>
      <span>{revenueMonthLabel(month)}</span>
      <span className="revenue-track" aria-hidden="true">
        {value !== undefined && value !== 0 && <i style={{ left: ((Math.min(value, 0) - stats.min) / range * 100) + "%", width: (Math.abs(value) / range * 100) + "%" }} />}
      </span>
      <strong>{value === undefined ? (plan.monthlyRevenue?.[month] !== undefined ? "Steuerangabe fehlt" : readOnly ? "–" : "Nachtragen") : money.format(value)}</strong>
    </button>;
  }
  const older = Object.keys(plan.monthlyRevenue ?? {}).filter(month => month < stats.months[11]).sort().reverse();
  return <section className="view" aria-labelledby="revenue-heading">
    <div className="section-title financial-heading"><h1 id="revenue-heading">Umsatz</h1>{!readOnly && <button className="edit-chip" type="button" onClick={() => selectMonth(stats.months.find(m => plan.monthlyRevenue?.[m] === undefined) ?? stats.months[0], plan)}>Monat nachtragen</button>}</div>
    <article className="detail-card">
      <h2>Letzte 12 abgeschlossene Monate</h2>
      <p>{stats.count} von 12 Monaten im Vergleich{missing > 0 && ` · Steuerangabe fehlt für ${missing} ${missing === 1 ? "Monat" : "Monate"}`}</p>
      <div className="detail-row"><span>{basis === "gross" ? "Bruttoumsatz" : "Nettoumsatz"} gesamt</span><b>{stats.count ? money.format(stats.total) : "–"}</b></div>
      <div className="detail-row"><span>Ø je erfasstem Monat</span><b>{stats.count ? money.format(stats.total / stats.count) : "–"}</b></div>
      <div className="revenue-rows">{stats.months.map(row)}</div>
    </article>
    {older.length > 0 && <details className="detail-card"><summary>Frühere Monate ({older.length})</summary>{older.map(month =>
      <button className="revenue-row" type="button" disabled={readOnly} key={month} onClick={() => selectMonth(month, plan)}><span>{revenueMonthLabel(month)}</span><span /><strong>{values[month] === undefined ? "Steuerangabe fehlt" : money.format(values[month])}</strong></button>)}</details>}
    {edit && <dialog ref={dialog} className="revenue-dialog" aria-labelledby="revenue-editor-title" onCancel={e => { e.preventDefault(); if (!saving) close(); }}>
      <form onSubmit={async e => {
        e.preventDefault();
        if (!validMonth || amount === null || saving) return;
        setSaving(true);
        const ok = await save(withRevenue(edit.base, edit.month, amount), edit.base);
        setSaving(false);
        if (ok) close(); else setFailed(true);
      }}>
        <h2 id="revenue-editor-title">Monatsumsatz</h2>
        <label>Monat<input type="month" required min="0001-01" max={stats.months[0]} value={edit.month} onChange={e => selectMonth(e.target.value, edit.base)} disabled={saving} /></label>
        <RevenueFields draft={draft} change={setDraft} disabled={saving} />
        {failed && <p role="alert">{problem || "Der Umsatz konnte nicht gespeichert werden."}</p>}
        <div><button type="button" onClick={close} disabled={saving}>Abbrechen</button><button className="primary-button" disabled={!validMonth || amount === null || saving}>Speichern</button></div>
      </form>
    </dialog>}
  </section>;
}
