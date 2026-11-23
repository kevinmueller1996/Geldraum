"use client";

import { useEffect, useRef, useState } from "react";
import type { Plan } from "./page";
import { revenueMonthLabel } from "./check-in";
import { RevenueFields } from "./revenue-fields";
import { draftFromRevenue, revenueAmounts, type RevenueVAT } from "./revenue-vat";
import type { VatBasis } from "./recurring-costs";

export type ConfirmedRevenue = {name: string; month: string; vat: RevenueVAT};
type Entry = ConfirmedRevenue & {id: string};
type Props = {plan: Plan; today: string; basis: VatBasis; readOnly: boolean; save: (plan: Plan, base: Plan) => Promise<boolean>};
const euro = new Intl.NumberFormat("de-DE", {style: "currency", currency: "EUR"});

export default function RevenueForecast({plan, today, basis, readOnly, save}: Props) {
  const currentMonth = today.slice(0, 7);
  const months = new Map<string, Entry[]>();
  for (const [id, entry] of Object.entries(plan.revenueForecast ?? {})) {
    const entries = months.get(entry.month) ?? [];
    entries.push({...entry, id});
    months.set(entry.month, entries);
  }
  const ordered = [...months.keys()].sort();
  const upcoming = ordered.filter(month => month >= currentMonth);
  const past = ordered.filter(month => month < currentMonth).reverse();
  const cents = (entries: Entry[]) => entries.reduce((sum, entry) => sum + Math.round(entry.vat[basis] * 100), 0);
  const futureTotal = upcoming.reduce((sum, month) => sum + cents(months.get(month)!), 0);
  const [selection, setSelection] = useState<{id: string; base: Plan} | null>(null);
  const [name, setName] = useState("");
  const [month, setMonth] = useState("");
  const [draft, setDraft] = useState(() => draftFromRevenue());
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (selection && !dialog.current?.open) dialog.current?.showModal(); }, [selection]);

  function edit(entry?: Entry) {
    setName(entry?.name ?? "");
    const next = new Date(today + "T12:00:00Z");
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + 1);
    setMonth(entry?.month ?? next.toISOString().slice(0, 7));
    setDraft(draftFromRevenue(entry?.vat.net, entry?.vat));
    setDeleting(false);
    setError("");
    setSelection({id: entry?.id ?? crypto.randomUUID(), base: plan});
  }
  function close() {
    dialog.current?.close();
    setSelection(null);
  }
  const previous = selection?.base.revenueForecast?.[selection.id];
  const vat = revenueAmounts(draft)?.meta;
  const earliest = previous && previous.month < currentMonth ? previous.month : currentMonth;
  const valid = !!name.trim() && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= earliest && vat && vat.net > 0 && vat.gross >= vat.net;
  async function submit() {
    if (!selection || busy || readOnly || (!deleting && !valid)) return;
    const entries = {...selection.base.revenueForecast};
    if (deleting) delete entries[selection.id];
    else entries[selection.id] = {name: name.trim(), month, vat: vat!};
    setBusy(true);
    try {
      if (await save({...selection.base, revenueForecast: entries}, selection.base)) close();
      else setError("Änderung konnte nicht gespeichert werden. Bitte prüfe den Synchronisierungsstatus.");
    } catch { setError("Speichern fehlgeschlagen. Bitte versuche es erneut."); }
    finally { setBusy(false); }
  }
  function group(key: string) {
    const entries = months.get(key)!;
    return <article className="detail-card" key={key}>
      <div className="section-title compact"><h2>{revenueMonthLabel(key)}</h2><strong>{euro.format(cents(entries) / 100)}</strong></div>
      {entries.sort((a,b) => a.name.localeCompare(b.name, "de")).map(entry =>
        <button type="button" className="detail-row forecast-entry" key={entry.id} disabled={readOnly} onClick={() => edit(entry)}>
          <span>{entry.name}</span><b>{euro.format(entry.vat[basis])}</b>
        </button>)}
    </article>;
  }
  return <section className="view" aria-labelledby="forecast-heading">
    <div className="section-title financial-heading"><h1 id="forecast-heading">Forecast</h1>
      {!readOnly && <button type="button" className="edit-chip" disabled={Object.keys(plan.revenueForecast ?? {}).length >= 1000} onClick={() => edit()}>Zusage erfassen</button>}
    </div>
    <div className="detail-card">
      <div className="detail-row"><span>Zugesagt ab {revenueMonthLabel(currentMonth)} · {basis === "gross" ? "brutto" : "netto"}</span><strong>{euro.format(futureTotal / 100)}</strong></div>
      {!upcoming.length && <p>Hier erscheinen bestätigte Aufträge nach erwartetem Umsatzmonat.</p>}
    </div>
    {upcoming.map(group)}
    {!!past.length && <details className="detail-card"><summary>Frühere Zusagen</summary>{past.map(group)}</details>}
    {selection && <dialog className="revenue-dialog" ref={dialog} onCancel={e => {e.preventDefault(); if (!busy) close();}} aria-labelledby="forecast-edit-heading">
      <form onSubmit={e => {e.preventDefault(); void submit();}}>
        <h2 id="forecast-edit-heading">{deleting ? "Zusage löschen?" : previous ? "Zusage bearbeiten" : "Zusage erfassen"}</h2>
        {deleting ? <p>{previous?.name} · {revenueMonthLabel(previous!.month)}</p> : <>
          <label>Auftrag oder Kunde<input autoFocus required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
          <label>Erwarteter Umsatzmonat<input type="month" required min={earliest} max="9999-12" value={month} onChange={e => setMonth(e.target.value)} /></label>
          <RevenueFields draft={draft} change={setDraft} legend="Zugesagter Umsatz" disabled={busy} />
        </>}
        {error && <p role="alert">{error}</p>}
        {previous && !deleting && <button type="button" className="edit-chip" disabled={busy} onClick={() => setDeleting(true)}>Zusage löschen</button>}
        <div><button type="button" disabled={busy} onClick={close}>Abbrechen</button><button className="primary-button" disabled={busy || (!deleting && !valid)}>{deleting ? "Löschen bestätigen" : "Speichern"}</button></div>
      </form>
    </dialog>}
  </section>;
}
