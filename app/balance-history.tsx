import { validCalendarDay } from "./plan-validation";
import type { Plan } from "./page";

const amount = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const day = (date: string) => new Date(date + "T12:00:00").toLocaleDateString("de-DE", {day:"numeric", month:"short", year:"numeric"});

export default function BalanceHistory({plan}: {plan:Plan}) {
  const entries = plan.snapshots.filter(entry => validCalendarDay(entry.date)).sort((a,b) => a.date.localeCompare(b.date)).map(entry => ({
    ...entry, value: entry.netBalance ?? plan.accounts.reduce((n,a) => n + (a.type === "credit" ? -1 : 1) * (entry.balances[a.id] ?? 0), 0),
  }));
  if (!entries.length) return null;
  const latest = entries[entries.length-1], first = entries[0];
  const min = Math.min(...entries.map(e => e.value)), max = Math.max(...entries.map(e => e.value));
  const time = (date:string) => Date.parse(date + "T12:00:00Z");
  const x = (date:string) => 8 + 304 * (time(date)-time(first.date)) / (time(latest.date)-time(first.date) || 1);
  const y = (value:number) => min === max ? 56 : 104 - 96 * (value-min)/(max-min);
  return <article className="detail-card balance-history">
    <h2>Kontostände im Verlauf</h2>
    <p><strong>{amount.format(latest.value)}</strong> · {day(latest.date)}</p>
    {entries.length > 1 && <><svg viewBox="0 0 320 112" role="img" aria-label={`Nettokontostand von ${amount.format(first.value)} bis ${amount.format(latest.value)}`}>
      <path d={entries.map((e,i) => (i ? "L" : "M") + x(e.date) + " " + y(e.value)).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
      <circle cx={x(latest.date)} cy={y(latest.value)} r="3" fill="currentColor"/>
    </svg><div className="history-dates"><span>{day(first.date)}</span><span>{day(latest.date)}</span></div></>}
    <details><summary>Check-ins anzeigen ({entries.length})</summary>{entries.reverse().map(e =>
      <div key={e.id} className="detail-row"><span>{day(e.date)}{e.note && <small>{e.note}</small>}</span><b>{amount.format(e.value)}</b></div>)}</details>
  </article>;
}
