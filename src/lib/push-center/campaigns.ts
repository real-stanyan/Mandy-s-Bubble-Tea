// Push Center — the campaign registry and every rule that can be tested
// without a network. Pure: no Square, no Supabase, no `server-only`.
//
// A campaign answers "who, and with which words". The who is a predicate over
// a customer's state (built from their Square order history, see
// customer-state.ts) plus their star balance; the words are a template with
// placeholders the audience builder fills per customer. Sending is a person
// clicking a button on /staff/push — nothing here schedules anything. The
// analysis behind each audience is in
// ~/mandy/operations/snapshots/2026-09-10/push-automation-plan.md.

import type { CustomerStateRow } from "./customer-state";
import { daysSince, favouriteItem, medianGapDays } from "./customer-state";

export type CampaignId =
  | "weekly_specials"
  | "near_threshold"
  | "redeem_ready"
  | "second_cup"
  | "overdue_regular"
  | "winback"
  | "hot_day"
  | "quiet_slot"
  | "rain_day"
  | "custom";

export type Platform = "all" | "ios" | "android";

/** Recency buckets over the last order — the vocabulary of the custom audience. */
export type Segment = "all" | "active" | "cooling" | "lapsing" | "lost" | "never";

export type Copy = { title: string; body: string };

/** Everything the owner can turn on the page. Persisted on the run row. */
export type CampaignSettings = {
  cooldownDays: number;
  platform: Platform;
  /** ≤2 marketing pushes per phone per 7 days, and ≥48h between two. */
  weeklyCap: boolean;
  /** Skip anyone who ordered in the last 24 hours. */
  skipRecentBuyers: boolean;
  /** Keep a stable 10% of customers out, so effect can be measured. */
  holdout: boolean;
  /** near_threshold / redeem_ready: only nudge people quiet for this long. */
  minInactiveDays: number;
  /** custom only. */
  segment: Segment;
};

/** Values the template can use. Every campaign fills what it knows. */
export type Vars = {
  drink?: string;
  stars?: number;
  n?: number;
  days?: number;
  temp?: number;
  items?: string;
  price?: string;
};

export type CampaignDef = {
  id: CampaignId;
  label: string;
  description: string;
  /** In-app route the tap opens (App: safeInAppPath on data.url). */
  url: string;
  defaultCopy: Copy;
  defaultSettings: CampaignSettings;
  /** Placeholders this campaign fills — shown beside the editor. */
  placeholders: Array<keyof Vars>;
  /** Needs star balances from Square Loyalty (a few-second scan). */
  needsStars: boolean;
  /** Needs today's forecast / the kitchen queue for context. */
  needsForecast?: boolean;
  needsKitchen?: boolean;
  /** Copy is drafted from the specials shelf + live Square prices. */
  needsSpecials?: boolean;
};

const BASE: CampaignSettings = {
  cooldownDays: 21,
  platform: "all",
  weeklyCap: true,
  skipRecentBuyers: true,
  holdout: false,
  minInactiveDays: 0,
  segment: "all",
};

export const CAMPAIGNS: Record<CampaignId, CampaignDef> = {
  weekly_specials: {
    id: "weekly_specials",
    label: "Weekly specials",
    description:
      "Everyone with the app. Drafted from this week's shelf and the live Square prices; refused at send time if a price moved.",
    url: "/menu",
    defaultCopy: {
      title: "🍹 New Weekly Specials",
      body: "{items} — {price}. This week's shelf is live!",
    },
    defaultSettings: { ...BASE, cooldownDays: 5, skipRecentBuyers: false },
    placeholders: ["items", "price"],
    needsStars: false,
    needsSpecials: true,
  },
  near_threshold: {
    id: "near_threshold",
    label: "1–2 stars short",
    description:
      "Balance 7–8 of 9. Best response of anything sent so far (36% redeemed within two weeks, Aug 4).",
    url: "/account",
    defaultCopy: {
      title: "⭐ {n} more {n|drink|drinks} and one's on us",
      body: "You're {n} {n|star|stars} away from a free drink. Your next {drink} gets you there.",
    },
    defaultSettings: { ...BASE, minInactiveDays: 7 },
    placeholders: ["n", "stars", "drink"],
    needsStars: true,
  },
  redeem_ready: {
    id: "redeem_ready",
    label: "Free drink waiting",
    description: "9+ stars and not redeemed. Clears the balance; a modest order lift.",
    url: "/account",
    defaultCopy: {
      title: "🎁 A free drink is waiting for you",
      body: "You've got {stars} {stars|star|stars} — enough for {n} free {n|drink|drinks}. Redeem it at checkout on your next order.",
    },
    defaultSettings: { ...BASE, cooldownDays: 14, minInactiveDays: 10 },
    placeholders: ["n", "stars", "drink"],
    needsStars: true,
  },
  second_cup: {
    id: "second_cup",
    label: "Second cup (day 5–14)",
    description:
      "One order, placed 5–14 days ago. Half of everyone who ever comes back does so inside 10 days.",
    url: "/menu",
    defaultCopy: {
      title: "🧋 Your first star is in",
      body: "That {drink} earned you star 1 of 9. Eight more and one's on us — see you soon?",
    },
    defaultSettings: { ...BASE, cooldownDays: 365 },
    placeholders: ["drink", "stars"],
    needsStars: true,
  },
  overdue_regular: {
    id: "overdue_regular",
    label: "Overdue regular",
    description:
      "3+ orders, quiet for longer than 1.5× their own usual gap (at least 10 days), up to 60 days.",
    url: "/menu",
    defaultCopy: {
      title: "👋 It's been {days} days",
      body: "Your {drink} is still on the menu, and you've still got {stars} {stars|star|stars} banked. Order ahead and it's ready in minutes.",
    },
    defaultSettings: { ...BASE },
    placeholders: ["days", "drink", "stars"],
    needsStars: true,
  },
  winback: {
    id: "winback",
    label: "Win-back (60–180 days)",
    description: "2+ orders, last one 2–6 months ago. One message, then leave them be.",
    url: "/account",
    defaultCopy: {
      title: "🧋 Your stars haven't expired",
      body: "It's been a while — you've still got {stars} {stars|star|stars} waiting, and so is your {drink}.",
    },
    defaultSettings: { ...BASE, cooldownDays: 90 },
    placeholders: ["days", "drink", "stars"],
    needsStars: true,
  },
  hot_day: {
    id: "hot_day",
    label: "Hot day",
    description:
      "Customers active in the last 30 days, on a day the forecast tops 26°. Days over 26° run 14% above normal with more slushies.",
    url: "/menu",
    defaultCopy: {
      title: "☀️ {temp}° in Southport today",
      body: "Slushy weather. Order ahead and it's ready in 2–3 minutes.",
    },
    defaultSettings: { ...BASE, cooldownDays: 7 },
    placeholders: ["temp"],
    needsStars: false,
    needsForecast: true,
  },
  quiet_slot: {
    id: "quiet_slot",
    label: "Beat the rush",
    description:
      "Evening regulars, sent around 4:45pm on a Tuesday or Thursday when the kitchen is quiet. Fills the 5pm dip.",
    url: "/menu",
    defaultCopy: {
      title: "⚡ Beat the 7pm rush",
      body: "The kitchen's quiet right now — order ahead and it's ready in 2–3 minutes.",
    },
    defaultSettings: { ...BASE, cooldownDays: 7 },
    placeholders: [],
    needsStars: false,
    needsKitchen: true,
  },
  rain_day: {
    id: "rain_day",
    label: "Rainy day",
    description:
      "Active customers on a wet day. An experiment: heavy rain costs 26% of a day and nobody moves online on their own.",
    url: "/menu",
    defaultCopy: {
      title: "🌧 Pouring out there?",
      body: "Order ahead and dash in — it'll be ready when you get here.",
    },
    defaultSettings: { ...BASE, cooldownDays: 7 },
    placeholders: [],
    needsStars: false,
    needsForecast: true,
  },
  custom: {
    id: "custom",
    label: "Custom",
    description: "Your own words, to everyone or to one recency group.",
    url: "/menu",
    defaultCopy: { title: "", body: "" },
    defaultSettings: { ...BASE, cooldownDays: 0, skipRecentBuyers: false },
    placeholders: ["drink", "stars"],
    needsStars: false,
  },
};

export const CAMPAIGN_IDS = Object.keys(CAMPAIGNS) as CampaignId[];

export function isCampaignId(s: unknown): s is CampaignId {
  return typeof s === "string" && s in CAMPAIGNS;
}

/**
 * Fill a template. `{drink}` style placeholders take the customer's value;
 * `{n|drink|drinks}` picks singular or plural on n. Unknown placeholders and
 * missing values are dropped rather than sent as literal braces — a customer
 * without a favourite reads "your next order", never "your next {drink}".
 * Whitespace left behind by a dropped word is collapsed.
 */
export function renderTemplate(template: string, vars: Vars): string {
  const out = template
    .replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (_m, key: string, one: string, many: string) => {
      const v = vars[key as keyof Vars];
      const n = typeof v === "number" ? v : Number(v);
      return n === 1 ? one : many;
    })
    .replace(/\{(\w+)\}/g, (_m, key: string) => {
      const v = vars[key as keyof Vars];
      if (v === undefined || v === null || v === "") return "";
      return String(v);
    });
  return out.replace(/[ \t]{2,}/g, " ").replace(/ ([,.!?])/g, "$1").trim();
}

export function renderCopy(copy: Copy, vars: Vars): Copy {
  return { title: renderTemplate(copy.title, vars), body: renderTemplate(copy.body, vars) };
}

/** What the customer's last order makes them, for the custom audience. */
export function segmentOf(state: CustomerStateRow | null, now: Date): Exclude<Segment, "all"> {
  if (!state?.last_order_at) return "never";
  const d = daysSince(state.last_order_at, now);
  if (d <= 14) return "active";
  if (d <= 30) return "cooling";
  if (d <= 60) return "lapsing";
  return "lost";
}

export type Candidate = {
  state: CustomerStateRow | null;
  /** Star balance, or null when unknown / no loyalty account. */
  balance: number | null;
};

export type Context = {
  starsPerReward: number;
  now: Date;
  /** Today's forecast maximum, when the campaign asked for it. */
  forecastMaxC?: number | null;
  /** Filled by the specials draft. */
  items?: string;
  price?: string;
};

const drinkOf = (state: CustomerStateRow | null): string | undefined =>
  state ? favouriteItem(state) ?? undefined : undefined;

/**
 * Does this customer belong in the campaign, and with which values? Null
 * means no. The rules are the ones the 2026-09-10 analysis landed on; the
 * numbers are in the campaign descriptions so the page and the code agree.
 */
export function matchCampaign(
  id: CampaignId,
  c: Candidate,
  settings: CampaignSettings,
  ctx: Context,
): Vars | null {
  const { state, balance } = c;
  const now = ctx.now;
  const since = state?.last_order_at ? daysSince(state.last_order_at, now) : null;
  const stars = balance ?? undefined;
  const drink = drinkOf(state);

  switch (id) {
    case "weekly_specials":
      return { items: ctx.items, price: ctx.price };

    case "near_threshold": {
      if (balance == null) return null;
      const deficit = ctx.starsPerReward - balance;
      if (deficit < 1 || deficit > 2) return null;
      if (settings.minInactiveDays > 0 && since !== null && since < settings.minInactiveDays) return null;
      return { n: deficit, stars: balance, drink };
    }

    case "redeem_ready": {
      if (balance == null || balance < ctx.starsPerReward) return null;
      if (settings.minInactiveDays > 0 && since !== null && since < settings.minInactiveDays) return null;
      return { n: Math.floor(balance / ctx.starsPerReward), stars: balance, drink };
    }

    case "second_cup": {
      if (!state || state.order_count !== 1 || !state.first_order_at) return null;
      const d = daysSince(state.first_order_at, now);
      if (d < 5 || d > 14) return null;
      return { drink, stars: stars ?? 1 };
    }

    case "overdue_regular": {
      if (!state || state.order_count < 3 || since === null) return null;
      const gap = medianGapDays(state);
      if (gap === null) return null;
      if (since <= Math.max(10, 1.5 * gap) || since > 60) return null;
      return { days: Math.round(since), drink, stars };
    }

    case "winback": {
      if (!state || state.order_count < 2 || since === null) return null;
      if (since <= 60 || since > 180) return null;
      return { days: Math.round(since), drink, stars };
    }

    case "hot_day":
    case "rain_day": {
      if (since === null || since > 30) return null;
      return { temp: ctx.forecastMaxC != null ? Math.round(ctx.forecastMaxC) : undefined };
    }

    case "quiet_slot": {
      if (!state || since === null || since > 14 || state.order_count < 2) return null;
      if (state.evening_orders / state.order_count < 0.5) return null;
      return {};
    }

    case "custom": {
      if (settings.segment !== "all" && segmentOf(state, now) !== settings.segment) return null;
      return { drink, stars };
    }
  }
}

/** Brisbane is UTC+10 all year (Queensland has no daylight saving). */
export function brisbaneHourMinutes(now: Date): { hour: number; minute: number; dow: number } {
  const t = new Date(now.getTime() + 10 * 3600 * 1000);
  return { hour: t.getUTCHours(), minute: t.getUTCMinutes(), dow: t.getUTCDay() };
}

/**
 * Marketing pushes go out between 10:30 and 20:30 shop time. The 9/7 noon
 * send caught the afternoon wave; an evening send lands on people in bed.
 * The page can override this — it is a warning with a checkbox, not a wall.
 */
export function isQuietHours(now: Date): boolean {
  const { hour, minute } = brisbaneHourMinutes(now);
  const m = hour * 60 + minute;
  return m < 10 * 60 + 30 || m >= 20 * 60 + 30;
}

/**
 * Stable 10% of customers by user id. The same person is always in or
 * always out, so a run this week and a run next week measure against the
 * same untouched group.
 */
export function inHoldout(userId: string): boolean {
  // FNV-1a over the id — cheap, deterministic, and no crypto import so the
  // client bundle can reuse the module's types without dragging node in.
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 10 === 0;
}

export type CapInput = {
  /** Marketing sends to this phone in the last 7 days (sent_at, newest first). */
  recentSends: Date[];
  now: Date;
};

/** ≤2 in 7 days and ≥48h since the last one. */
export function underWeeklyCap({ recentSends, now }: CapInput): boolean {
  const week = now.getTime() - 7 * 86_400_000;
  const inWeek = recentSends.filter((d) => d.getTime() > week);
  if (inWeek.length >= 2) return false;
  const last = inWeek[0] ? Math.max(...inWeek.map((d) => d.getTime())) : null;
  if (last !== null && now.getTime() - last < 48 * 3600 * 1000) return false;
  return true;
}

export function normaliseSettings(
  id: CampaignId,
  raw: Partial<CampaignSettings> | undefined,
): CampaignSettings {
  const d = CAMPAIGNS[id].defaultSettings;
  const num = (v: unknown, fallback: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.floor(v)) : fallback;
  const platform: Platform =
    raw?.platform === "ios" || raw?.platform === "android" ? raw.platform : "all";
  const segments: Segment[] = ["all", "active", "cooling", "lapsing", "lost", "never"];
  return {
    cooldownDays: num(raw?.cooldownDays, d.cooldownDays, 3650),
    platform,
    weeklyCap: typeof raw?.weeklyCap === "boolean" ? raw.weeklyCap : d.weeklyCap,
    skipRecentBuyers:
      typeof raw?.skipRecentBuyers === "boolean" ? raw.skipRecentBuyers : d.skipRecentBuyers,
    holdout: typeof raw?.holdout === "boolean" ? raw.holdout : d.holdout,
    minInactiveDays: num(raw?.minInactiveDays, d.minInactiveDays, 365),
    segment: segments.includes(raw?.segment as Segment) ? (raw!.segment as Segment) : d.segment,
  };
}

export function validCopy(copy: Partial<Copy> | undefined): copy is Copy {
  if (!copy) return false;
  const { title, body } = copy;
  return (
    typeof title === "string" &&
    typeof body === "string" &&
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    title.length <= 120 &&
    body.length <= 300
  );
}
