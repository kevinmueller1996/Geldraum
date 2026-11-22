import { useState } from "react";
import DecimalInput from "./decimal-input";
import { depreciation, type AssetBasis } from "./depreciation";
import { validDepreciation } from "./plan-validation";
const euros = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

export default function DepreciationFields({ asset, today, update }: {
  asset: AssetBasis; today: string; update: (patch: Partial<Omit<AssetBasis, "kind">>) => void;
}) {
  const enabled = asset.depreciationStart !== undefined;
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const projection = validDepreciation(asset) && /^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth)
    ? depreciation(asset, selectedMonth) : null;
  return <fieldset className="depreciation-fields">
    <legend>Abschreibung</legend>
    <label><input type="checkbox" checked={enabled} onChange={e => update(e.target.checked
      ? { depreciationStart: today.slice(0, 7), usefulLifeMonths: 36, residualValue: 0 }
      : { balance: (validDepreciation(asset) ? depreciation(asset, today)?.book : undefined) ?? asset.balance, depreciationStart: undefined, usefulLifeMonths: undefined, residualValue: undefined })} /> Linear planen</label>
    {enabled && <>
      <div className="depreciation-inputs">
        <label>Erster Abschreibungsmonat<input type="month" required value={asset.depreciationStart} onChange={e => update({ depreciationStart: e.target.value })} /></label>
        <label>Nutzungsdauer in Monaten<input type="number" min="1" max="1200" step="1" required value={asset.usefulLifeMonths || ""} onChange={e => update({ usefulLifeMonths: Number(e.target.value) })} /></label>
        <label>Restwert am Ende (€)<DecimalInput value={asset.residualValue} signed={false} placeholder="0,00" onValueChange={residualValue => update({ residualValue })} /></label>
      </div>
      <label>Buchwert berechnen für<input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} /></label>
      {projection && <p aria-live="polite">Ø {euros.format(projection.monthly)} pro Monat · Buchwert zum Monatsende {euros.format(projection.book)}</p>}
    </>}
  </fieldset>;
}
