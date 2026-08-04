// One-off: seed loyalty_push_recipients with the two campaigns that were
// sent on 2026-08-04 by the pre-admin one-off scripts, so the cooldown in
// /admin/loyalty-push knows about them.
//
// Without this, the first send from the admin UI re-notifies everyone who
// was pushed that day — the cooldown reads a table those scripts never
// wrote to.
//
// ACCURACY CAVEAT: the original scripts recorded nothing, so the audience
// is reconstructed by re-running the same predicates against live balances.
// Anyone whose balance moved since (ordered a drink, redeemed a reward) is
// now matched by a different campaign than the one they were actually sent,
// or by none at all. For a 14-21 day "don't nag them again" window that is
// close enough; it is not an audit trail, and the run rows it writes are
// marked as backfilled so nobody later reads them as real send metrics.
//
// Run once, AFTER applying scripts/migrations/005:
//   npx tsx scripts/backfill-loyalty-push-history.ts [--apply]
import { createClient } from "@supabase/supabase-js";
import { SquareClient, SquareEnvironment } from "square";
import { Expo } from "expo-server-sdk";
import { CAMPAIGNS, type CampaignId } from "../src/lib/loyalty-campaigns";

const APPLY = process.argv.includes("--apply");

// The actual send date, not "now" — the cooldown window has to start when
// the customer's phone buzzed, not when this cleanup ran.
const SENT_AT = "2026-08-04T05:30:00.000Z";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const squareToken = process.env.SQUARE_ACCESS_TOKEN;
if (!url || !serviceKey || !squareToken) {
  console.error(
    "need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SQUARE_ACCESS_TOKEN (production)",
  );
  process.exit(1);
}

const sb = createClient(url, serviceKey);
const square = new SquareClient({
  token: squareToken,
  environment: SquareEnvironment.Production,
});

async function pageAll<T>(table: string, select: string, orderCol: string): Promise<T[]> {
  const rows: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from(table)
      .select(select)
      .order(orderCol, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} page ${from}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  const program = await square.loyalty.programs.get({ programId: "main" });
  const tiers: number[] = [];
  for (const t of program.program?.rewardTiers ?? []) {
    const p = Number((t as { points?: unknown }).points);
    if (Number.isFinite(p)) tiers.push(p);
  }
  const starsPerReward = Math.min(...tiers);

  const balances = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const resp = await square.loyalty.accounts.search({ limit: 200, cursor });
    for (const a of resp.loyaltyAccounts ?? []) {
      const phone = a.mapping?.phoneNumber;
      if (phone) balances.set(phone, Number(a.balance ?? 0));
    }
    cursor = resp.cursor;
  } while (cursor);

  const [devices, profiles] = await Promise.all([
    pageAll<{ user_id: string; token: string }>("device_push_tokens", "user_id,token", "id"),
    pageAll<{ user_id: string; phone_e164: string | null }>(
      "user_profiles",
      "user_id,phone_e164",
      "user_id",
    ),
  ]);
  const phoneOf = new Map(profiles.map((p) => [p.user_id, p.phone_e164]));

  const reachable = new Set<string>();
  for (const d of devices) {
    const phone = phoneOf.get(d.user_id);
    if (phone && Expo.isExpoPushToken(d.token)) reachable.add(phone);
  }

  for (const id of Object.keys(CAMPAIGNS) as CampaignId[]) {
    const campaign = CAMPAIGNS[id];
    const phones = [...reachable].filter(
      (p) => campaign.match(balances.get(p) ?? -1, starsPerReward) != null,
    );
    console.log(`${id}: ${phones.length} phones`);

    if (!APPLY) continue;

    const { data, error } = await sb
      .from("loyalty_push_runs")
      .insert({
        campaign: id,
        title_singular: campaign.defaultCopy.titleSingular,
        body_singular: campaign.defaultCopy.bodySingular,
        title_plural: campaign.defaultCopy.titlePlural,
        body_plural: campaign.defaultCopy.bodyPlural,
        cooldown_days: 0,
        eligible_count: 0,
        suppressed_count: 0,
        targeted_count: phones.length,
        accepted_count: 0,
        errored_count: 0,
        created_by: null,
        created_at: SENT_AT,
      })
      .select("id")
      .single();
    if (error) throw new Error(`run insert: ${error.message}`);

    const runId = (data as { id: string }).id;
    if (phones.length > 0) {
      const { error: recErr } = await sb.from("loyalty_push_recipients").insert(
        phones.map((phone) => ({
          run_id: runId,
          campaign: id,
          phone_e164: phone,
          sent_at: SENT_AT,
        })),
      );
      if (recErr) throw new Error(`recipients insert: ${recErr.message}`);
    }
    console.log(`  wrote run ${runId} + ${phones.length} recipients`);
  }

  if (!APPLY) console.log("\nDRY RUN — re-run with --apply to write.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
