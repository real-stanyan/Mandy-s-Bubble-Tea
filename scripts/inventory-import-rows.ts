// One-off backfill: rows pulled out of the stock-check report emails
// (date \t section \t name \t qty \t reorder-at) -> shop counts in the
// warehouse inventory. Run from the repo root with the shop env loaded:
//
//   set -a; source ~/dev/Mandy-s-Bubble-Tea/.env.local; set +a
//   npx tsx --conditions=react-server scripts/inventory-import-rows.ts <rows.tsv> [--dry]
//
// Twin names ("Orange", "Lemon" are each a syrup and a fruit) are resolved
// the way report-import.ts does — by list order when both are in the same
// section — plus one extra clue the rows carry: the reorder threshold on an
// "Order these" line, which tells the fruit lemon (reorder at 2 since
// 2026-08-14) from the syrup (reorder at 1).
import fs from "node:fs";
import { ALL_ITEMS, STOCK_LIST } from "../src/lib/staff/stocklist";
import { parseReportDate } from "../src/lib/staff/report-import";
import { buildView, mergeShopCounts, type ShopCount } from "../src/lib/staff/inventory";
import { readInventory, writeInventory } from "../src/lib/staff/inventory-store";
import { brisbaneDate } from "../src/lib/staff/stock-history";

const file = process.argv[2];
const dry = process.argv.includes("--dry");
if (!file) throw new Error("usage: inventory-import-rows.ts <rows.tsv> [--dry]");

type Row = { date: string; sec: string; name: string; qty: number; thr: number | null };

const rows: Row[] = [];
for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
  const [d, sec, name, qty, thr] = line.split("\t");
  if (!d || !sec || !name) continue;
  const date = parseReportDate(d);
  const q = Number(qty);
  if (!date || !Number.isFinite(q)) continue;
  if (sec === "W") continue; // weekly lines are not in the inventory
  rows.push({ date, sec, name: name.trim(), qty: q, thr: thr ? Number(thr) : null });
}

const byName = new Map<string, string[]>();
for (const cat of STOCK_LIST) for (const it of cat.items) {
  const k = it.name.toLowerCase();
  byName.set(k, [...(byName.get(k) ?? []), it.id]);
}
const listIndex = new Map(ALL_ITEMS.map((i, n) => [i.id, n]));
// Effective reorder thresholds while the emails were being sent. Overrides
// were set on 2026-08-14 (read from app_settings.stock_thresholds).
const OVERRIDE_FROM = "2026-08-14";
const OVERRIDES: Record<string, number> = {
  "other-lime": 2, "other-cream": 5, "other-lemon": 2, "powder-thai": 2, "syrup-mango": 2,
  "syrup-peach": 2, "syrup-lychee": 2, "powder-brulee": 2, "powder-matcha": 2, "powder-coconut": 2,
  "powder-pudding": 2, "topping-aloe-vera": 2, "powder-silver-taro": 2, "topping-oat-popping": 2,
  "powder-colorful-taro": 2, "topping-chocolate-popping": 2, "topping-strawberry-popping": 3,
};
function thresholdOn(id: string, date: string): number | null {
  const it = ALL_ITEMS.find((i) => i.id === id);
  if (!it || it.rule.kind !== "threshold") return null;
  return date >= OVERRIDE_FROM && OVERRIDES[id] != null ? OVERRIDES[id] : it.rule.value;
}

const unknown = new Set<string>();
const ambiguous: string[] = [];
const byDate = new Map<string, Record<string, number>>();

const dates = [...new Set(rows.map((r) => r.date))].sort();
for (const date of dates) {
  const day = rows.filter((r) => r.date === date);
  const counts: Record<string, number> = {};
  const names = new Set(day.map((r) => r.name.toLowerCase()));
  for (const key of names) {
    const ids = byName.get(key);
    const mine = day.filter((r) => r.name.toLowerCase() === key);
    if (!ids) { unknown.add(mine[0].name); continue; }
    if (ids.length === 1) { counts[ids[0]] = mine[mine.length - 1].qty; continue; }
    const ordered = [...ids].sort((a, b) => (listIndex.get(a) ?? 0) - (listIndex.get(b) ?? 0));
    // Same section, all twins present: list order.
    const bySec = new Map<string, Row[]>();
    for (const r of mine) bySec.set(r.sec, [...(bySec.get(r.sec) ?? []), r]);
    const assigned = new Map<string, number>();
    const leftover: Row[] = [];
    for (const [, rs] of bySec) {
      if (rs.length === ordered.length) rs.forEach((r, i) => assigned.set(ordered[i], r.qty));
      else leftover.push(...rs);
    }
    // Anything left: try the threshold clue, then "the other one".
    for (const r of leftover) {
      const free = ordered.filter((id) => !assigned.has(id));
      let hit: string | null = null;
      if (r.thr != null) {
        const match = free.filter((id) => thresholdOn(id, date) === r.thr);
        if (match.length === 1) hit = match[0];
      }
      if (!hit && free.length === 1) hit = free[0];
      if (hit) assigned.set(hit, r.qty);
      else ambiguous.push(`${date} ${r.name} (${r.sec})`);
    }
    for (const [id, q] of assigned) counts[id] = q;
  }
  byDate.set(date, counts);
}

const counts: ShopCount[] = [...byDate.entries()].map(([date, c]) => ({ date, counts: c }));
console.log(`days parsed: ${counts.length} (${dates[0]} … ${dates[dates.length - 1]})`);
console.log(`unknown names: ${[...unknown].join(", ") || "none"}`);
console.log(`ambiguous skipped: ${ambiguous.length}${ambiguous.length ? "\n  " + ambiguous.join("\n  ") : ""}`);

async function main() {
  const now = new Date();
  const state = await readInventory(now);
  const { state: next, added } = mergeShopCounts(state, counts);
  console.log(`existing days: ${state.shopCounts.length}, added: ${added}, total: ${next.shopCounts.length}`);
  if (dry) { console.log("(dry run — nothing written)"); return; }
  const ok = await writeInventory(next);
  console.log(ok ? "written" : "WRITE FAILED");
  const view = buildView(next, brisbaneDate(now));
  console.log("\nitem                    warehouse  shop  usage/d  span  bring");
  for (const r of view.rows.filter((r) => r.qty != null)) {
    console.log(
      `${r.id.padEnd(24)}${String(r.qty).padStart(8)}${String(r.shop?.qty ?? "—").padStart(7)}${
        r.usagePerDay == null ? "       —" : r.usagePerDay.toFixed(2).padStart(8)
      }${String(r.usage.spanDays).padStart(6)}${String(r.suggestion.bring).padStart(7)}  ${r.suggestion.reason}`,
    );
  }
}
void main();
