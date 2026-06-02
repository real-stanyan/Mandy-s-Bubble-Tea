// One-time retro: backfill missed loyalty accruals over the last 30 days.
// Dry-run by default (reports counts + sample). Pass --apply to write.
// Run: set -a; source .env.production; set +a; node scripts/backfill-loyalty-30d.mjs [--apply]

import { SquareClient, SquareEnvironment } from "square";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const DAYS = Number(process.env.DAYS ?? 30);

const sq = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN,
  environment: (process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT ?? "production") === "production"
    ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
});
const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const LOC = process.env.SQUARE_LOCATION_ID;
const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000).toISOString();

const isSettled = (o) =>
  o.state === "COMPLETED" ||
  (o.tenders ?? []).some((t) => (t.type === "CARD" ? t.cardDetails?.status === "CAPTURED" : true));

async function alreadyAccrued(orderId) {
  const ev = await sq.loyalty.searchEvents({
    query: { filter: { orderFilter: { orderId }, typeFilter: { types: ["ACCUMULATE_POINTS"] } } },
  });
  return (ev.events ?? []).length > 0;
}

// 1. collect candidate orders (paid + customer attached)
const candidates = [];
let cursor;
do {
  const res = await sq.orders.search({
    locationIds: [LOC],
    query: {
      filter: { dateTimeFilter: { createdAt: { startAt: since } }, stateFilter: { states: ["COMPLETED", "OPEN"] } },
      sort: { sortField: "CREATED_AT", sortOrder: "DESC" },
    },
    limit: 500,
    cursor,
  });
  for (const o of (res.orders ?? [])) {
    if (o.id && o.customerId && isSettled(o)) candidates.push(o);
  }
  cursor = res.cursor;
} while (cursor);

console.log(`candidates (paid + customer) in ${DAYS}d: ${candidates.length}`);

// 2. find the genuine misses
const misses = [];
for (const o of candidates) {
  if (await alreadyAccrued(o.id)) continue;
  misses.push(o);
}
console.log(`genuine misses (no accrual yet): ${misses.length}`);
for (const o of misses.slice(0, 20)) {
  console.log(`  ${o.createdAt?.slice(0, 16)}  cust=${o.customerId}  order=${o.id}`);
}

if (!APPLY) {
  console.log(`\nDRY RUN. Re-run with --apply to backfill these ${misses.length} orders.`);
  process.exit(0);
}

// 3. apply
let accrued = 0;
for (const o of misses) {
  // claim ledger slot
  const { error: claimErr } = await supa
    .from("loyalty_backfill_log")
    .insert({ square_order_id: o.id, source: "retro" });
  if (claimErr) {
    if (claimErr.code === "23505") continue; // already done
    console.error(`claim failed ${o.id}: ${claimErr.message}`);
    continue;
  }
  try {
    const cust = (await sq.customers.get({ customerId: o.customerId }))?.customer;
    const phone = cust?.phoneNumber;
    if (!phone) { await supa.from("loyalty_backfill_log").delete().eq("square_order_id", o.id); continue; }
    // find-or-create loyalty account by phone
    const found = await sq.loyalty.accounts.search({ query: { mappings: [{ phoneNumber: phone }] }, limit: 1 });
    let accountId = found.loyaltyAccounts?.[0]?.id;
    if (!accountId) {
      const prog = await sq.loyalty.programs.get({ programId: "main" });
      const created = await sq.loyalty.accounts.create({
        idempotencyKey: `retro-enroll:${o.id}`,
        loyaltyAccount: { programId: prog.program.id, customerId: o.customerId, mapping: { phoneNumber: phone } },
      });
      accountId = created.loyaltyAccount?.id;
    }
    await sq.loyalty.accounts.accumulatePoints({
      accountId,
      idempotencyKey: `backfill:${o.id}`,
      locationId: LOC,
      accumulatePoints: { orderId: o.id },
    });
    await supa.from("loyalty_backfill_log").update({ loyalty_account_id: accountId }).eq("square_order_id", o.id);
    accrued++;
  } catch (e) {
    await supa.from("loyalty_backfill_log").delete().eq("square_order_id", o.id);
    console.error(`accrue failed ${o.id}: ${e?.message ?? e}`);
  }
}
console.log(`\nAPPLIED. backfilled ${accrued}/${misses.length} orders.`);
