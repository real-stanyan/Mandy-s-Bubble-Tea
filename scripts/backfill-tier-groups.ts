// scripts/backfill-tier-groups.ts
// Pages ALL loyalty accounts, derives tier from lifetimePoints, and syncs
// Square customer-group membership via tierGroupPlan. Dry-run by default;
// --apply executes. Rerunnable any time (also the repair tool after admin
// customer merges). Sequential + 150ms delay to stay rate-limit friendly.
// Run: set -a; source .env.production; set +a; npx tsx scripts/backfill-tier-groups.ts [--apply]
import { SquareClient, SquareEnvironment } from "square";
import { syncTierGroups, tierGroupPlan } from "../src/lib/tier-group-sync";
import { tierFor } from "../src/lib/membership-tier";

const APPLY = process.argv.includes("--apply");
const token = process.env.SQUARE_ACCESS_TOKEN;
const goldId = process.env.SQUARE_TIER_GROUP_GOLD_ID;
const diamondId = process.env.SQUARE_TIER_GROUP_DIAMOND_ID;
if (!token || !goldId || !diamondId) {
  console.error(
    "need SQUARE_ACCESS_TOKEN + SQUARE_TIER_GROUP_GOLD_ID + SQUARE_TIER_GROUP_DIAMOND_ID",
  );
  process.exit(1);
}
const IDS = { gold: goldId, diamond: diamondId };
const client = new SquareClient({
  token,
  environment:
    (process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT ?? "production") === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. page all loyalty accounts (search() awaits directly; cursor pagination)
  type Acct = { customerId: string; lifetimePoints: number };
  const accounts: Acct[] = [];
  let cursor: string | undefined;
  do {
    const res = await client.loyalty.accounts.search({ limit: 30, cursor });
    for (const a of res.loyaltyAccounts ?? []) {
      if (a.customerId) {
        accounts.push({
          customerId: a.customerId,
          lifetimePoints: a.lifetimePoints ?? 0,
        });
      }
    }
    cursor = res.cursor ?? undefined;
  } while (cursor);
  console.log(`loyalty accounts: ${accounts.length}`);

  // 2. plan / apply per member (only gold+ need a customers.get round-trip;
  //    silver with no possible membership still gets checked for repair —
  //    cheap and keeps the script the single repair authority)
  const stats = { goldAdd: 0, diamondAdd: 0, removed: 0, ok: 0, errors: 0 };
  for (const acct of accounts) {
    try {
      if (APPLY) {
        const plan = await syncTierGroups(
          client,
          acct.customerId,
          acct.lifetimePoints,
          IDS,
        );
        tally(plan, acct);
      } else {
        const res = await client.customers.get({ customerId: acct.customerId });
        const plan = tierGroupPlan(
          acct.lifetimePoints,
          res.customer?.groupIds ?? [],
          IDS,
        );
        tally(plan, acct);
      }
    } catch (err) {
      stats.errors++;
      console.error(
        `  ERROR ${acct.customerId}: ${err instanceof Error ? err.message : err}`,
      );
    }
    await sleep(150);
  }

  function tally(
    plan: { add: string[]; remove: string[] },
    acct: Acct,
  ) {
    if (plan.add.length === 0 && plan.remove.length === 0) {
      stats.ok++;
      return;
    }
    if (plan.add.includes(IDS.gold)) stats.goldAdd++;
    if (plan.add.includes(IDS.diamond)) stats.diamondAdd++;
    stats.removed += plan.remove.length;
    console.log(
      `  ${APPLY ? "SYNCED" : "WOULD SYNC"} ${acct.customerId} pts=${acct.lifetimePoints} tier=${tierFor(acct.lifetimePoints)} add=[${plan.add}] remove=[${plan.remove}]`,
    );
  }

  console.log(
    `\n${APPLY ? "APPLIED" : "DRY-RUN"}: +gold=${stats.goldAdd} +diamond=${stats.diamondAdd} removals=${stats.removed} already-correct=${stats.ok} errors=${stats.errors}`,
  );
  if (!APPLY) console.log("rerun with --apply to execute");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
