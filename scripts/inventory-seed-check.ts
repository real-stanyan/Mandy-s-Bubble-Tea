// One-off: read (and thereby seed) the warehouse inventory, then print a
// summary. Run from the repo root with the shop's Supabase env loaded:
//
//   set -a; source ~/dev/Mandy-s-Bubble-Tea/.env.local; set +a
//   npx tsx --conditions=react-server scripts/inventory-seed-check.ts
//
// `--conditions=react-server` is what lets the `server-only` guard in the
// store import under plain Node.
import { readInventory } from "../src/lib/staff/inventory-store";
import { buildView } from "../src/lib/staff/inventory";
import { brisbaneDate } from "../src/lib/staff/stock-history";

async function main() {
  const now = new Date();
  const state = await readInventory(now);
  const view = buildView(state, brisbaneDate(now));
  console.log(`items: ${state.items.length}, shop counts: ${state.shopCounts.length}, pickups: ${state.pickups.length}, cover ${state.coverDays}d`);
  console.log(`with warehouse qty: ${state.items.filter((i) => i.qty != null).length}`);
  console.log(`latest shop count: ${view.lastShopCountDate}`);
  for (const r of view.rows.filter((r) => r.qty != null).slice(0, 6)) {
    console.log(`  ${r.id.padEnd(22)} wh=${r.qty} shop=${r.shop?.qty ?? "—"} usage=${r.usagePerDay ?? "—"} bring=${r.suggestion.bring} (${r.suggestion.reason})`);
  }
}
void main();
