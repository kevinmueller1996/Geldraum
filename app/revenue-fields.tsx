import { acceptsAmountEdit } from "./amount";
import { revenueAmounts, switchRevenueBasis, type RevenueDraft } from "./revenue-vat";

const euros = new Intl.NumberFormat("de-DE", {style:"currency", currency:"EUR"});

export function RevenueFields({ draft, change, disabled, legend = "Monatsumsatz" }: { draft: RevenueDraft; change: (d: RevenueDraft) => void; disabled?: boolean; legend?: string }) {
  const pair = revenueAmounts(draft)?.meta;
  return <fieldset className="payment-fields vat-fields" disabled={disabled}>
    <legend>{legend}</legend>
    <label>Eingabe als<select value={draft.basis} onChange={e => change(switchRevenueBasis(draft, e.target.value === "net" ? "net" : "gross"))}>
      <option value="gross" disabled={draft.basis === "net" && !!draft.amount && !pair}>Brutto</option><option value="net" disabled={draft.basis === "gross" && !!draft.amount && !pair}>Netto</option>
    </select></label>
    <label>{draft.basis === "gross" ? "Bruttoumsatz" : "Nettoumsatz"} (€)<input inputMode="decimal" required value={draft.amount} placeholder="0,00" onChange={e => { if (acceptsAmountEdit(e.target.value)) change({...draft, amount:e.target.value, originalGross:undefined}); }} /></label>
    <label>Steuerangabe<select value={draft.method} onChange={e => change({...draft, method:e.target.value === "tax" ? "tax" : "rate", tax:"", originalGross:undefined})}><option value="rate">Steuersatz</option><option value="tax">Umsatzsteuer in Euro</option></select></label>
    <label>{draft.method === "rate" ? "Steuersatz (%)" : "Umsatzsteuer gesamt (€)"}<input inputMode="decimal" value={draft.tax} required={draft.basis === "gross"} onChange={e => { if (acceptsAmountEdit(e.target.value, draft.method === "tax")) change({...draft, tax:e.target.value, originalGross:undefined}); }} /></label>
    <small className="vat-summary">{pair ? euros.format(pair.gross) + " brutto · " + euros.format(pair.net) + " netto" : "Für die Umrechnung Steuersatz oder Umsatzsteuer angeben. Bei gemischten Steuersätzen die gesamte Umsatzsteuer in Euro eintragen."}</small>
  </fieldset>;
}
