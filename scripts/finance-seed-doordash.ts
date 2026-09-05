// One-off: load DoorDash payouts read out of the shop inbox (from \t to \t
// amount, US dates) into the finance ledger, then warm the Square revenue
// cache for the default range. Run from the repo root with the shop env:
//
//   set -a; source ~/dev/Mandy-s-Bubble-Tea/.env.local
//   source ~/projects/Mandy-s-Bubble-Tea/.env.production.local; set +a
//   npx tsx --conditions=react-server scripts/finance-seed-doordash.ts <payouts.tsv>
import fs from "node:fs";
import { readFinance, writeFinance, defaultRange } from "../src/lib/staff/finance-store";
import { upsertEntry } from "../src/lib/staff/finance";
import { squareRevenueByDay } from "../src/lib/staff/square-revenue";
import { brisbaneDate } from "../src/lib/staff/stock-history";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: finance-seed-doordash.ts <payouts.tsv>");
  const now = new Date();
  let state = await readFinance();
  const before = state.entries.length;
  const us = (s: string) => {
    const [m, d, y] = s.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  };
  let n = 0;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const [a, b, amt] = line.split("\t");
    if (!a || !b || !amt) continue;
    const from = us(a), to = us(b), amount = Number(amt);
    state = upsertEntry(state, { kind: "doordash", from, to, amount, note: "", ref: `doordash:${from}..${to}:${amount.toFixed(2)}` }, now);
    n++;
  }
  console.log(`payouts in file: ${n}; ledger ${before} → ${state.entries.length}`);
  console.log("written:", await writeFinance(state));
  const dd = state.entries.filter((e) => e.kind === "doordash");
  const total = dd.reduce((s, e) => s + e.amount, 0);
  console.log(`doordash total $${total.toFixed(2)} over ${dd[0]?.from} … ${dd[dd.length - 1]?.to}`);

  const { from, to } = defaultRange(now);
  console.log(`warming Square revenue ${from} → ${to} …`);
  const t0 = Date.now();
  const r = await squareRevenueByDay(from, to, brisbaneDate(now));
  const days = Object.keys(r.byDay).sort();
  const sum = Object.values(r.byDay).reduce((s, v) => s + v, 0);
  console.log(`fetched ${r.fetchedDays} days in ${((Date.now() - t0) / 1000).toFixed(0)}s; ${days.length} days cached; total $${sum.toFixed(0)}; last: ${days.slice(-3).map((d) => `${d}=$${r.byDay[d].toFixed(0)}`).join(" ")}`);
}
void main();
