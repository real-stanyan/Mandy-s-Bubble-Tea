import "server-only";
import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { squareClient } from "@/lib/square";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { isMissingTableError } from "@/lib/postgrest-errors";
import { getActiveProgram } from "@/lib/loyalty";
import {
  CAMPAIGNS,
  renderCopy,
  type Audience,
  type CampaignCopy,
  type CampaignDef,
  type CampaignId,
  type Recipient,
} from "@/lib/loyalty-campaigns";

// I/O half of the loyalty campaigns (definitions live in the pure module).
//
// Both campaigns answer the same shape of question — "which customers are at
// an interesting point in their star balance, and which of those can we
// actually reach in-app?" — so they share one audience builder and differ
// only in the balance predicate and the copy.
//
// Reachability is proxied by `device_push_tokens`: a phone with at least one
// registered Expo token. That under-counts installs (someone who declined the
// notification permission has the app but no token) and is the right bias
// here — better to miss a customer than to count one we cannot notify.

/** PostgREST silently caps a bare select; page explicitly. */
async function pageAll<T>(
  table: string,
  select: string,
  orderCol: string,
): Promise<T[]> {
  const admin = getSupabaseAdmin();
  const rows: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
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

/**
 * Walk every loyalty account in the program and keep the phones this campaign
 * targets. Square pages at 200; the whole scan is a few seconds for a few
 * thousand accounts, which is why the routes calling this raise maxDuration.
 */
async function matchedPhones(
  campaign: CampaignDef,
  starsPerReward: number,
): Promise<Map<string, number>> {
  const matched = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const resp = await squareClient.loyalty.accounts.search({ limit: 200, cursor });
    for (const acct of resp.loyaltyAccounts ?? []) {
      const phone = acct.mapping?.phoneNumber;
      if (!phone) continue;
      const n = campaign.match(Number(acct.balance ?? 0), starsPerReward);
      if (n != null) matched.set(phone, n);
    }
    cursor = resp.cursor;
  } while (cursor);
  return matched;
}

/**
 * Phones that already received this campaign inside the cooldown window.
 * `cooldownDays <= 0` disables suppression entirely.
 */
async function suppressedPhones(
  campaign: CampaignId,
  cooldownDays: number,
): Promise<Set<string>> {
  if (cooldownDays <= 0) return new Set();
  const since = new Date(Date.now() - cooldownDays * 86_400_000).toISOString();
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("loyalty_push_recipients")
    .select("phone_e164")
    .eq("campaign", campaign)
    .gte("sent_at", since);
  if (error) throw new Error(`cooldown lookup: ${error.message}`);
  return new Set((data ?? []).map((r) => (r as { phone_e164: string }).phone_e164));
}

/**
 * Whether migration 005 has been applied.
 *
 * The send path has to ask this explicitly rather than lean on the cooldown
 * query failing: with `cooldownDays = 0` the cooldown never touches the table,
 * so the pushes go out and only the bookkeeping afterwards discovers the table
 * is missing — the exact double-notify this feature exists to prevent.
 */
export async function campaignTablesReady(): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("loyalty_push_recipients").select("id").limit(1);
  if (!error) return true;
  if (isMissingTableError(error)) return false;
  // Anything else (network, auth, RLS) is a real failure and must not be
  // reported to the caller as "just run the migration".
  throw new Error(`loyalty_push_recipients probe: ${error.message}`);
}

export async function buildAudience(
  campaignId: CampaignId,
  cooldownDays: number,
): Promise<Audience> {
  const campaign = CAMPAIGNS[campaignId];
  const { starsPerReward } = await getActiveProgram();

  const [matched, devices, profiles, suppressed] = await Promise.all([
    matchedPhones(campaign, starsPerReward),
    pageAll<{ user_id: string; token: string }>(
      "device_push_tokens",
      "user_id,token",
      "id",
    ),
    pageAll<{ user_id: string; phone_e164: string | null }>(
      "user_profiles",
      "user_id,phone_e164",
      "user_id",
    ),
    suppressedPhones(campaignId, cooldownDays),
  ]);

  const phoneOf = new Map(profiles.map((p) => [p.user_id, p.phone_e164]));

  const reachable = new Set<string>();
  const suppressedHits = new Set<string>();
  const recipients: Recipient[] = [];
  for (const d of devices) {
    const phone = phoneOf.get(d.user_id);
    if (!phone) continue;
    const n = matched.get(phone);
    if (n == null) continue;
    reachable.add(phone);
    if (suppressed.has(phone)) {
      suppressedHits.add(phone);
      continue;
    }
    if (!Expo.isExpoPushToken(d.token)) continue;
    recipients.push({ phone, token: d.token, n });
  }

  const byN = new Map<number, Set<string>>();
  for (const r of recipients) {
    if (!byN.has(r.n)) byN.set(r.n, new Set());
    byN.get(r.n)!.add(r.phone);
  }

  return {
    starsPerReward,
    eligiblePhones: matched.size,
    reachablePhones: reachable.size,
    suppressedPhones: suppressedHits.size,
    recipients,
    breakdown: [...byN.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, phones]) => ({ n, phones: phones.size })),
  };
}

export type SendResult = { accepted: number; errored: number; errors: string[] };

export async function sendCampaign(
  campaignId: CampaignId,
  copy: CampaignCopy,
  recipients: Recipient[],
): Promise<SendResult> {
  const campaign = CAMPAIGNS[campaignId];
  const expo = new Expo();
  const messages: ExpoPushMessage[] = recipients.map((r) => {
    const { title, body } = renderCopy(copy, r.n);
    return {
      to: r.token,
      sound: "default",
      title,
      body,
      data: { type: campaignId, url: campaign.route },
    };
  });

  let accepted = 0;
  let errored = 0;
  const errors: string[] = [];
  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      for (const t of tickets) {
        if (t.status === "ok") accepted++;
        else {
          errored++;
          // One line per distinct failure reason is enough for the admin UI —
          // a dev-build token missing APNs credentials produces the same
          // message for every device it affects.
          if (t.message && !errors.includes(t.message)) errors.push(t.message);
        }
      }
    } catch (err) {
      errored += chunk.length;
      const msg = err instanceof Error ? err.message : String(err);
      if (!errors.includes(msg)) errors.push(msg);
    }
  }
  return { accepted, errored, errors };
}

/**
 * Record the run and every phone it reached. The recipient rows are what the
 * next audience build reads for the cooldown, so this must happen even when
 * some pushes errored — an errored ticket still means the attempt was made
 * and the customer may well have got it.
 */
export async function recordRun(args: {
  campaign: CampaignId;
  copy: CampaignCopy;
  cooldownDays: number;
  audience: Pick<Audience, "eligiblePhones" | "suppressedPhones">;
  recipients: Recipient[];
  result: SendResult;
  createdBy: string;
}): Promise<string> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("loyalty_push_runs")
    .insert({
      campaign: args.campaign,
      title_singular: args.copy.titleSingular,
      body_singular: args.copy.bodySingular,
      title_plural: args.copy.titlePlural,
      body_plural: args.copy.bodyPlural,
      cooldown_days: args.cooldownDays,
      eligible_count: args.audience.eligiblePhones,
      suppressed_count: args.audience.suppressedPhones,
      targeted_count: args.recipients.length,
      accepted_count: args.result.accepted,
      errored_count: args.result.errored,
      created_by: args.createdBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(`recordRun: ${error.message}`);

  const runId = (data as { id: string }).id;
  const phones = [...new Set(args.recipients.map((r) => r.phone))];
  if (phones.length > 0) {
    const { error: recErr } = await admin.from("loyalty_push_recipients").insert(
      phones.map((phone) => ({
        run_id: runId,
        campaign: args.campaign,
        phone_e164: phone,
      })),
    );
    if (recErr) throw new Error(`recordRun recipients: ${recErr.message}`);
  }
  return runId;
}
