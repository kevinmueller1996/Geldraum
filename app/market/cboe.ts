type Snapshot = { asOf: string; prices: Map<string, number> };
const source = "https://accounteu.cboe.com/dxe/market_data/symbol_listing/csv/";

// Cboe recommends using the complete file after 07:00 London time.
export function snapshotDay(now: Date) {
  const clock = new Intl.DateTimeFormat("sv-SE", {timeZone:"Europe/London", year:"numeric", month:"2-digit",
    day:"2-digit", hour:"2-digit", hourCycle:"h23"}).formatToParts(now);
  const part = (name: string) => clock.find(p => p.type === name)!.value;
  const date = new Date(part("year") + "-" + part("month") + "-" + part("day") + "T12:00:00Z");
  if (Number(part("hour")) < 7) date.setUTCDate(date.getUTCDate() - 1);
  while ([0,6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0,10);
}

function fields(line: string) {
  const matches = line.match(/(?:^|,)(?:"(?:[^"]|"")*"|[^",]*)/g);
  if (!matches || matches.join("") !== line) return [];
  return matches.map((raw,i) => {
    const cell = i ? raw.slice(1) : raw;
    return cell.startsWith('"') ? cell.slice(1,-1).replace(/""/g,'"') : cell;
  });
}

export function parseCloses(csv: string, requested: string): Snapshot {
  const [descriptor, heading, ...rows] = csv.trimEnd().split(/\r?\n/);
  const meta = Object.fromEntries(descriptor.split(",").map(pair => pair.split("=")));
  const created = Date.parse(meta.created);
  if (!Number.isFinite(created) || new Date(created).toISOString().slice(0,10) !== meta.created) throw Error("Invalid Cboe snapshot date");
  if (meta.environment !== "PROD" || meta.warning !== "" || !/^\d{4}-\d{2}-\d{2}$/.test(meta.created) ||
      meta.created > requested || Date.parse(requested) - created > 7 * 86400000) throw Error("Invalid Cboe snapshot");
  const columns = fields(heading ?? "");
  const [isin, currency, live, kind, primary, close] = ["isin","currency","live","asset_class","mic","bats_prev_close"].map(k => columns.indexOf(k));
  if ([isin,currency,live,kind,primary,close].includes(-1)) throw Error("Unknown Cboe columns");
  const listings = new Map<string,{rank:string; price:number; ambiguous:boolean}>();
  for (const row of rows) {
    const cells = fields(row);
    const id = cells[isin], price = Number(cells[close]);
    if (cells.length !== columns.length || cells[live] !== "t" || cells[currency] !== "EUR" ||
        !["ETF","EQTY"].includes(cells[kind]) || !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(id) ||
        !/^[A-Z0-9]{4}$/.test(cells[primary]) || !Number.isFinite(price) || price <= 0) continue;
    // Prefer the German listing. Keep the choice stable when the CSV order changes.
    const rank = cells[primary] === "XETR" ? "0" : "1" + cells[primary];
    const old = listings.get(id);
    if (!old || rank < old.rank) listings.set(id, {rank, price, ambiguous:false});
    else if (rank === old.rank && price !== old.price) old.ambiguous = true;
  }
  const prices = new Map<string,number>();
  for (const [id,listing] of listings) if (!listing.ambiguous) prices.set(id,listing.price);
  if (!prices.size) throw Error("Empty Cboe snapshot");
  return {asOf:meta.created, prices};
}

let cached: {day:string; result:Promise<Snapshot>} | undefined;
export async function closingPrices(isins: Set<string>) {
  if (!isins.size) return;
  const day = snapshotDay(new Date());
  if (cached?.day !== day) {
    const result = (async () => {
      const response = await fetch(source + "?selectedDate=" + day, {redirect:"manual", signal:AbortSignal.timeout(4500), next:{revalidate:1800}});
      if (!response.ok) throw Error("Cboe HTTP " + response.status);
      return parseCloses(await response.text(),day);
    })();
    cached = {day,result};
    result.catch(() => { if (cached?.result === result) cached = undefined; });
  }
  const snapshot = await cached.result;
  return {asOf:snapshot.asOf, prices:Object.fromEntries([...isins].filter(id => snapshot.prices.has(id)).map(id => [id,snapshot.prices.get(id)!]))};
}
