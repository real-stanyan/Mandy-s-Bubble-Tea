// scripts/push-state-backfill.ts
//
// First fill of push_customer_state: fold the last N days of Square orders
// into one row per customer and set the scan cursor so the half-hourly cron
// (/api/cron/push-state-refresh) can take it from there.
//
// Rebuilds every row from the window it scans, so it is also the way to
// repair the table: --force replaces whatever is there.
//
// Env: production Square (SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID,
// NEXT_PUBLIC_SQUARE_ENVIRONMENT=production) + Supabase service role.
// Dry-run by default; --apply writes.
//
//   set -a; source .env.production.local; set +a
//   set -a; source ~/dev/Mandy-s-Bubble-Tea/.env.local; set +a   # Supabase only
//   export NEXT_PUBLIC_SQUARE_ENVIRONMENT=production
//   npx tsx scripts/push-state-backfill.ts --days 120 [--apply] [--force]
import { createClient } from "@supabase/supabase-js";
import { SquareClient, SquareEnvironment } from "square";
import { foldOrders, groupByCustomer, type CustomerStateRow } from "../src/lib/push-center/customer-state";
import { scanOrders } from "../src/lib/push-center/square-orders";
import { readCursor, upsertStates, writeCursor } from "../src/lib/push-center/state-store";
import { SETTLE_LAG_MS } from "../src/lib/push-center/refresh";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg >= 0 ? Number(process.argv[daysArg + 1]) : 120;

const token = process.env.SQUARE_ACCESS_TOKEN;
const locationId = process.env.SQUARE_LOCATION_ID;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!token || !locationId || !url || !serviceKey) {
  console.error("need SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT !== "production") {
  console.error("refusing: NEXT_PUBLIC_SQUARE_ENVIRONMENT must be production (sandbox has no customers to speak of)");
  process.exit(1);
}
if (!Number.isFinite(DAYS) || DAYS <= 0 || DAYS > 400) {
  console.error("--days must be 1..400");
  process.exit(1);
}

const square = new SquareClient({ token, environment: SquareEnvironment.Production });
const admin = createClient(url, serviceKey);

async function main() {
  const now = new Date();
  const existing = await readCursor(admin);
  if (existing && !FORCE) {
    console.error(`cursor already set (${existing.cursor}); the cron keeps it moving. Use --force to rebuild.`);
    process.exit(1);
  }
  const endMs = now.getTime() - SETTLE_LAG_MS;
  const window = { startAt: new Date(endMs - DAYS * 86_400_000).toISOString(), endAt: new Date(endMs).toISOString() };
  console.log(`scanning ${window.startAt} → ${window.endAt}`);
  const orders = await scanOrders(square, locationId!, window, (page, total) =>
    process.stderr.write(`  page ${page}: ${total} orders\r`),
  );
  process.stderr.write("\n");
  const grouped = groupByCustomer(orders);
  const rows: CustomerStateRow[] = [];
  for (const [, list] of grouped) rows.push(foldOrders(null, list, now));
  const regulars = rows.filter((r) => r.order_count >= 3).length;
  console.log(`${orders.length} orders with a customer → ${rows.length} customers (${regulars} with 3+ orders)`);
  if (!APPLY) {
    console.log("DRY RUN — re-run with --apply to write.");
    return;
  }
  await upsertStates(admin, rows);
  await writeCursor(admin, {
    cursor: window.endAt,
    lastRun: { at: now.toISOString(), orders: orders.length, customers: rows.length, window },
  });
  console.log(`wrote ${rows.length} rows; cursor = ${window.endAt}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
