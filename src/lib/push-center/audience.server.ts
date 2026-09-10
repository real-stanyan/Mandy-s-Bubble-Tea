import "server-only";
import { Expo } from "expo-server-sdk";
import { squareClient } from "@/lib/square";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getActiveProgram } from "@/lib/loyalty";
import {
  CAMPAIGNS,
  inHoldout,
  matchCampaign,
  renderCopy,
  underWeeklyCap,
  type CampaignId,
  type CampaignSettings,
  type Context,
  type Copy,
  type Vars,
} from "./campaigns";
import { daysSince, type CustomerStateRow } from "./customer-state";
import { loadAllStates, stateSummary, type StateSummary } from "./state-store";
import { draftSpecials, type SpecialsDraft } from "./specials.server";
import { getForecast, getKitchen, type Forecast, type Kitchen } from "./context.server";

// Push Center — who gets this campaign, right now.
//
// Reachability is a Square customer with a registered Expo token, joined
// through user_profiles.square_customer_id (the mapping the order-ready push
// already relies on). Someone with the app but no notification permission
// has no token and is simply not counted — the bias the loyalty campaigns
// chose as well: better to miss a customer than to count one we can't reach.
//
// Everything that can say no is applied here, in order, and counted, so the
// page can show the funnel instead of a bare number: has the app → matches
// the rule → not on cooldown → under the weekly cap → not a buyer today →
// not in the holdout → devices.

export type Recipient = {
  userId: string;
  customerId: string | null;
  phone: string | null;
  token: string;
  platform: "ios" | "android";
  vars: Vars;
};

export type Funnel = {
  /** Customers with at least one push token (after the platform filter). */
  withApp: number;
  /** …of those, the campaign's rule matched. */
  matched: number;
  cooldown: number;
  capped: number;
  recentBuyers: number;
  holdout: number;
  /** Devices that will be pushed. */
  devices: number;
  ios: number;
  android: number;
};

export type AudienceReport = {
  campaign: CampaignId;
  settings: CampaignSettings;
  funnel: Funnel;
  recipients: Recipient[];
  /** Up to three rendered messages, distinct where the copy varies. */
  samples: Copy[];
  context: {
    starsPerReward: number;
    forecast: Forecast | null;
    kitchen: Kitchen | null;
    specials: SpecialsDraft | null;
    state: StateSummary;
  };
  /** Specials only: what the copy was drafted from; send refuses on a mismatch. */
  fingerprint: string | null;
};

const PAGE = 1000;

async function pageAll<T>(table: string, select: string, orderCol: string): Promise<T[]> {
  const admin = getSupabaseAdmin();
  const rows: T[] = [];
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
 * Star balance for a set of Square customers. Asked by customer id in
 * batches of 30 (the API's ceiling) a few at a time: a full program scan
 * is 23 sequential pages and took the preview past 40 seconds; this is a
 * couple of seconds for everyone who has the app.
 */
async function loadBalancesFor(customerIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const chunks: string[][] = [];
  for (let i = 0; i < customerIds.length; i += 30) chunks.push(customerIds.slice(i, i + 30));
  const CONCURRENCY = 4;
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    await Promise.all(
      chunks.slice(i, i + CONCURRENCY).map(async (chunk) => {
        const resp = await squareClient.loyalty.accounts.search({
          query: { customerIds: chunk },
          limit: chunk.length,
        });
        for (const a of resp.loyaltyAccounts ?? []) {
          if (a.customerId) out.set(a.customerId, Number(a.balance ?? 0));
        }
      }),
    );
  }
  return out;
}

type Ledger = {
  /** user_id → marketing sends in the last 7 days, newest first. */
  recent: Map<string, Date[]>;
  /** user_id (or legacy phone:<e164>) that had THIS campaign inside the cooldown. */
  onCooldown: Set<string>;
};

async function loadLedger(campaign: CampaignId, cooldownDays: number, now: Date): Promise<Ledger> {
  const admin = getSupabaseAdmin();
  const lookbackDays = Math.max(7, cooldownDays);
  const since = new Date(now.getTime() - lookbackDays * 86_400_000).toISOString();
  const cooldownSince = new Date(now.getTime() - cooldownDays * 86_400_000).toISOString();

  const recent = new Map<string, Date[]>();
  const onCooldown = new Set<string>();

  const { data, error } = await admin
    .from("push_run_recipients")
    .select("user_id,phone_e164,campaign,sent_at")
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(20000);
  if (error) {
    // 42P01: migration not applied yet. Sending is refused elsewhere; the
    // preview can still show the audience.
    if (error.code !== "42P01" && !/does not exist/i.test(error.message)) {
      throw new Error(`push_run_recipients: ${error.message}`);
    }
  } else {
    for (const r of (data ?? []) as Array<{
      user_id: string | null;
      phone_e164: string | null;
      campaign: string;
      sent_at: string;
    }>) {
      if (!r.user_id) continue;
      const list = recent.get(r.user_id) ?? [];
      list.push(new Date(r.sent_at));
      recent.set(r.user_id, list);
      if (cooldownDays > 0 && r.campaign === campaign && r.sent_at >= cooldownSince) {
        onCooldown.add(r.user_id);
      }
    }
  }

  // The loyalty campaigns were sent from /admin/loyalty-push before this
  // page existed; their cooldown table is keyed by phone.
  if (cooldownDays > 0 && (campaign === "near_threshold" || campaign === "redeem_ready")) {
    const { data: legacy } = await admin
      .from("loyalty_push_recipients")
      .select("phone_e164")
      .eq("campaign", campaign)
      .gte("sent_at", cooldownSince);
    for (const r of (legacy ?? []) as Array<{ phone_e164: string }>) onCooldown.add(`phone:${r.phone_e164}`);
  }
  return { recent, onCooldown };
}

function templateNeedsStars(copy: Copy): boolean {
  return /\{(stars|n)[|}]/.test(copy.title + " " + copy.body);
}

export async function buildAudience(
  campaign: CampaignId,
  settings: CampaignSettings,
  copy: Copy,
  now: Date = new Date(),
): Promise<AudienceReport> {
  const def = CAMPAIGNS[campaign];
  const admin = getSupabaseAdmin();

  const wantStars = def.needsStars || templateNeedsStars(copy);
  const [profiles, devices, states, ledger, program, forecast, kitchen, specials, summary] = await Promise.all([
    pageAll<{ user_id: string; square_customer_id: string | null; phone_e164: string | null }>(
      "user_profiles",
      "user_id,square_customer_id,phone_e164",
      "user_id",
    ),
    pageAll<{ user_id: string; token: string; platform: "ios" | "android" }>(
      "device_push_tokens",
      "user_id,token,platform",
      "id",
    ),
    loadAllStates(admin).catch((err) => {
      // Table missing → every customer is "no history"; the page says so.
      if (/does not exist/i.test(String(err))) return new Map<string, CustomerStateRow>();
      throw err;
    }),
    loadLedger(campaign, settings.cooldownDays, now),
    wantStars ? getActiveProgram() : Promise.resolve(null),
    def.needsForecast ? getForecast() : Promise.resolve(null),
    def.needsKitchen ? getKitchen() : Promise.resolve(null),
    def.needsSpecials ? draftSpecials() : Promise.resolve(null),
    stateSummary(admin),
  ]);

  const devicesByUser = new Map<string, Array<{ token: string; platform: "ios" | "android" }>>();
  for (const d of devices) {
    if (!Expo.isExpoPushToken(d.token)) continue;
    if (settings.platform !== "all" && d.platform !== settings.platform) continue;
    const list = devicesByUser.get(d.user_id) ?? [];
    list.push({ token: d.token, platform: d.platform });
    devicesByUser.set(d.user_id, list);
  }

  // Only profiles with a device can be pushed, and only their balances are
  // worth asking Square for. One profile per Square customer: a customer
  // who re-registered keeps the newest mapping and is counted once.
  const reachable: Array<{ userId: string; customerId: string | null; phone: string | null }> = [];
  const seenCustomers = new Set<string>();
  for (const p of profiles) {
    if (!devicesByUser.has(p.user_id)) continue;
    if (p.square_customer_id) {
      if (seenCustomers.has(p.square_customer_id)) continue;
      seenCustomers.add(p.square_customer_id);
    }
    reachable.push({ userId: p.user_id, customerId: p.square_customer_id, phone: p.phone_e164 });
  }

  const balances = wantStars
    ? await loadBalancesFor(reachable.map((r) => r.customerId).filter((id): id is string => !!id))
    : new Map<string, number>();

  const ctx: Context = {
    starsPerReward: program?.starsPerReward ?? 9,
    now,
    forecastMaxC: forecast?.maxC ?? null,
    items: specials?.itemsText,
    price: specials?.priceText,
  };

  const funnel: Funnel = {
    withApp: reachable.length,
    matched: 0,
    cooldown: 0,
    capped: 0,
    recentBuyers: 0,
    holdout: 0,
    devices: 0,
    ios: 0,
    android: 0,
  };
  const recipients: Recipient[] = [];

  for (const p of reachable) {
    const state = p.customerId ? (states.get(p.customerId) ?? null) : null;
    const balance = p.customerId ? (balances.get(p.customerId) ?? null) : null;
    const vars = matchCampaign(campaign, { state, balance }, settings, ctx);
    if (!vars) continue;
    funnel.matched++;

    if (ledger.onCooldown.has(p.userId) || (p.phone && ledger.onCooldown.has(`phone:${p.phone}`))) {
      funnel.cooldown++;
      continue;
    }
    if (settings.weeklyCap && !underWeeklyCap({ recentSends: ledger.recent.get(p.userId) ?? [], now })) {
      funnel.capped++;
      continue;
    }
    if (settings.skipRecentBuyers && state?.last_order_at && daysSince(state.last_order_at, now) < 1) {
      funnel.recentBuyers++;
      continue;
    }
    if (settings.holdout && inHoldout(p.userId)) {
      funnel.holdout++;
      continue;
    }
    for (const d of devicesByUser.get(p.userId) ?? []) {
      recipients.push({
        userId: p.userId,
        customerId: p.customerId,
        phone: p.phone,
        token: d.token,
        platform: d.platform,
        vars,
      });
      funnel.devices++;
      if (d.platform === "ios") funnel.ios++;
      else funnel.android++;
    }
  }

  const samples: Copy[] = [];
  const seenSample = new Set<string>();
  for (const r of recipients) {
    const rendered = renderCopy(copy, r.vars);
    const key = rendered.title + "\n" + rendered.body;
    if (seenSample.has(key)) continue;
    seenSample.add(key);
    samples.push(rendered);
    if (samples.length >= 3) break;
  }

  return {
    campaign,
    settings,
    funnel,
    recipients,
    samples,
    context: { starsPerReward: ctx.starsPerReward, forecast, kitchen, specials, state: summary },
    fingerprint: specials?.fingerprint ?? null,
  };
}
