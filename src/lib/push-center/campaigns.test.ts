import { describe, expect, it } from "vitest";
import {
  CAMPAIGNS,
  CAMPAIGN_IDS,
  inHoldout,
  isQuietHours,
  matchCampaign,
  normaliseSettings,
  renderTemplate,
  segmentOf,
  underWeeklyCap,
  validCopy,
  type Context,
} from "./campaigns";
import { emptyState, type CustomerStateRow } from "./customer-state";

const NOW = new Date("2026-09-10T02:00:00.000Z"); // 12:00 Brisbane, Thursday
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

function state(patch: Partial<CustomerStateRow>): CustomerStateRow {
  return { ...emptyState("c1"), ...patch };
}

/** A regular with orders every `gap` days, the last one `sinceLast` days ago. */
function regular(n: number, gap: number, sinceLast: number): CustomerStateRow {
  const recent = [];
  for (let i = n - 1; i >= 0; i--) {
    recent.push({ id: `o${i}`, at: ago(sinceLast + i * gap), ch: "app" as const });
  }
  return state({
    order_count: n,
    first_order_at: recent[0].at,
    last_order_at: recent[recent.length - 1].at,
    recent_orders: recent,
    item_counts: { "Brown Sugar Milk Tea": n },
  });
}

const ctx: Context = { starsPerReward: 9, now: NOW };
const settingsOf = (id: keyof typeof CAMPAIGNS) => CAMPAIGNS[id].defaultSettings;

describe("renderTemplate", () => {
  it("fills placeholders and picks singular or plural on n", () => {
    expect(renderTemplate("{n} more {n|drink|drinks}", { n: 1 })).toBe("1 more drink");
    expect(renderTemplate("{n} more {n|drink|drinks}", { n: 2 })).toBe("2 more drinks");
    expect(renderTemplate("Your {drink} earned {stars} stars", { drink: "Taro Milk Tea", stars: 3 })).toBe(
      "Your Taro Milk Tea earned 3 stars",
    );
  });

  it("drops what it does not know instead of sending braces to a customer", () => {
    expect(renderTemplate("Your next {drink} gets you there.", {})).toBe("Your next gets you there.");
    expect(renderTemplate("Hi {nope}!", {})).toBe("Hi!");
  });
});

describe("matchCampaign", () => {
  it("near_threshold: 7–8 stars, quiet for the minimum, gives the deficit", () => {
    const s = settingsOf("near_threshold");
    const quiet = state({ order_count: 4, last_order_at: ago(9), item_counts: { "Taro Milk Tea": 3 } });
    expect(matchCampaign("near_threshold", { state: quiet, balance: 8 }, s, ctx)).toEqual({
      n: 1,
      stars: 8,
      drink: "Taro Milk Tea",
    });
    expect(matchCampaign("near_threshold", { state: quiet, balance: 7 }, s, ctx)?.n).toBe(2);
    expect(matchCampaign("near_threshold", { state: quiet, balance: 6 }, s, ctx)).toBeNull();
    expect(matchCampaign("near_threshold", { state: quiet, balance: 9 }, s, ctx)).toBeNull();
    // Bought two days ago: they are coming anyway.
    const fresh = state({ order_count: 4, last_order_at: ago(2) });
    expect(matchCampaign("near_threshold", { state: fresh, balance: 8 }, s, ctx)).toBeNull();
    // No order on record at all (POS-only history) still qualifies.
    expect(matchCampaign("near_threshold", { state: null, balance: 8 }, s, ctx)?.n).toBe(1);
  });

  it("redeem_ready: counts whole free drinks", () => {
    const s = settingsOf("redeem_ready");
    const quiet = state({ order_count: 6, last_order_at: ago(12) });
    expect(matchCampaign("redeem_ready", { state: quiet, balance: 19 }, s, ctx)?.n).toBe(2);
    expect(matchCampaign("redeem_ready", { state: quiet, balance: 8 }, s, ctx)).toBeNull();
    expect(matchCampaign("redeem_ready", { state: null, balance: null }, s, ctx)).toBeNull();
  });

  it("second_cup: exactly one order, 5–14 days old", () => {
    const s = settingsOf("second_cup");
    const one = (d: number) =>
      state({ order_count: 1, first_order_at: ago(d), last_order_at: ago(d), item_counts: { "Mango Slushy": 1 } });
    expect(matchCampaign("second_cup", { state: one(6), balance: 1 }, s, ctx)).toEqual({
      drink: "Mango Slushy",
      stars: 1,
    });
    expect(matchCampaign("second_cup", { state: one(4), balance: 1 }, s, ctx)).toBeNull();
    expect(matchCampaign("second_cup", { state: one(15), balance: 1 }, s, ctx)).toBeNull();
    expect(matchCampaign("second_cup", { state: { ...one(6), order_count: 2 }, balance: 2 }, s, ctx)).toBeNull();
  });

  it("overdue_regular: past 1.5× their own gap, floor 10 days, ceiling 60", () => {
    const s = settingsOf("overdue_regular");
    // Every 6 days → overdue once quiet more than 10 (max(10, 9)).
    expect(matchCampaign("overdue_regular", { state: regular(5, 6, 8), balance: 4 }, s, ctx)).toBeNull();
    expect(matchCampaign("overdue_regular", { state: regular(5, 6, 12), balance: 4 }, s, ctx)).toEqual({
      days: 12,
      drink: "Brown Sugar Milk Tea",
      stars: 4,
    });
    // Every 20 days → the bar is 30, not 10.
    expect(matchCampaign("overdue_regular", { state: regular(4, 20, 25), balance: 2 }, s, ctx)).toBeNull();
    expect(matchCampaign("overdue_regular", { state: regular(4, 20, 35), balance: 2 }, s, ctx)?.days).toBe(35);
    // Gone past 60 days belongs to win-back, not here.
    expect(matchCampaign("overdue_regular", { state: regular(4, 6, 61), balance: 2 }, s, ctx)).toBeNull();
    // Two orders is not a regular.
    expect(matchCampaign("overdue_regular", { state: regular(2, 6, 30), balance: 2 }, s, ctx)).toBeNull();
  });

  it("winback: 2+ orders, 60–180 days quiet", () => {
    const s = settingsOf("winback");
    expect(matchCampaign("winback", { state: regular(3, 7, 90), balance: 5 }, s, ctx)?.days).toBe(90);
    expect(matchCampaign("winback", { state: regular(3, 7, 60), balance: 5 }, s, ctx)).toBeNull();
    expect(matchCampaign("winback", { state: regular(3, 7, 181), balance: 5 }, s, ctx)).toBeNull();
  });

  it("hot_day / rain_day: active in 30 days, carries the forecast", () => {
    const s = settingsOf("hot_day");
    const c = { ...ctx, forecastMaxC: 28.6 };
    expect(matchCampaign("hot_day", { state: regular(2, 7, 20), balance: null }, s, c)).toEqual({ temp: 29 });
    expect(matchCampaign("hot_day", { state: regular(2, 7, 31), balance: null }, s, c)).toBeNull();
    expect(matchCampaign("rain_day", { state: null, balance: null }, s, c)).toBeNull();
  });

  it("quiet_slot: recent evening regulars only", () => {
    const s = settingsOf("quiet_slot");
    const evening = state({ order_count: 6, evening_orders: 4, last_order_at: ago(3), first_order_at: ago(40) });
    const daytime = state({ order_count: 6, evening_orders: 1, last_order_at: ago(3), first_order_at: ago(40) });
    expect(matchCampaign("quiet_slot", { state: evening, balance: null }, s, ctx)).toEqual({});
    expect(matchCampaign("quiet_slot", { state: daytime, balance: null }, s, ctx)).toBeNull();
  });

  it("custom: everyone, or one recency segment", () => {
    const all = settingsOf("custom");
    expect(matchCampaign("custom", { state: null, balance: null }, all, ctx)).toEqual({ drink: undefined, stars: undefined });
    const lapsing = { ...all, segment: "lapsing" as const };
    expect(matchCampaign("custom", { state: regular(2, 7, 45), balance: 3 }, lapsing, ctx)).not.toBeNull();
    expect(matchCampaign("custom", { state: regular(2, 7, 5), balance: 3 }, lapsing, ctx)).toBeNull();
    const never = { ...all, segment: "never" as const };
    expect(matchCampaign("custom", { state: null, balance: null }, never, ctx)).not.toBeNull();
    expect(matchCampaign("custom", { state: regular(2, 7, 5), balance: 3 }, never, ctx)).toBeNull();
  });

  it("weekly_specials: everyone, with the drafted shelf", () => {
    const s = settingsOf("weekly_specials");
    const c = { ...ctx, items: "Strawberry Slushy & Guava Iced Green Tea", price: "$4.60" };
    expect(matchCampaign("weekly_specials", { state: null, balance: null }, s, c)).toEqual({
      items: c.items,
      price: c.price,
    });
  });

  it("every campaign has copy, a route and a settings block", () => {
    for (const id of CAMPAIGN_IDS) {
      const def = CAMPAIGNS[id];
      expect(def.url.startsWith("/")).toBe(true);
      expect(def.defaultSettings.cooldownDays).toBeGreaterThanOrEqual(0);
      if (id !== "custom") expect(validCopy(def.defaultCopy)).toBe(true);
    }
  });
});

describe("segmentOf", () => {
  it("buckets on days since the last order", () => {
    expect(segmentOf(null, NOW)).toBe("never");
    expect(segmentOf(state({ last_order_at: ago(3) }), NOW)).toBe("active");
    expect(segmentOf(state({ last_order_at: ago(20) }), NOW)).toBe("cooling");
    expect(segmentOf(state({ last_order_at: ago(45) }), NOW)).toBe("lapsing");
    expect(segmentOf(state({ last_order_at: ago(90) }), NOW)).toBe("lost");
  });
});

describe("guardrails", () => {
  it("quiet hours are before 10:30 and from 20:30, Brisbane time", () => {
    expect(isQuietHours(new Date("2026-09-10T00:15:00Z"))).toBe(true); // 10:15
    expect(isQuietHours(new Date("2026-09-10T00:30:00Z"))).toBe(false); // 10:30
    expect(isQuietHours(new Date("2026-09-10T10:29:00Z"))).toBe(false); // 20:29
    expect(isQuietHours(new Date("2026-09-10T10:30:00Z"))).toBe(true); // 20:30
    expect(isQuietHours(new Date("2026-09-10T14:00:00Z"))).toBe(true); // midnight
  });

  it("weekly cap: at most two in seven days, 48 hours apart", () => {
    const h = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
    expect(underWeeklyCap({ recentSends: [], now: NOW })).toBe(true);
    expect(underWeeklyCap({ recentSends: [h(24)], now: NOW })).toBe(false);
    expect(underWeeklyCap({ recentSends: [h(49)], now: NOW })).toBe(true);
    expect(underWeeklyCap({ recentSends: [h(72), h(120)], now: NOW })).toBe(false);
    expect(underWeeklyCap({ recentSends: [h(72), h(24 * 8)], now: NOW })).toBe(true);
  });

  it("holdout is stable and roughly a tenth", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `user-${i}-${(i * 7919) % 1000}`);
    const held = ids.filter(inHoldout).length;
    expect(held).toBeGreaterThan(140);
    expect(held).toBeLessThan(260);
    expect(inHoldout("abc")).toBe(inHoldout("abc"));
  });

  it("normaliseSettings clamps and falls back to the campaign defaults", () => {
    const s = normaliseSettings("near_threshold", { cooldownDays: -3, platform: "mac" as never, segment: "x" as never });
    expect(s.cooldownDays).toBe(21);
    expect(s.platform).toBe("all");
    expect(s.segment).toBe("all");
    expect(s.minInactiveDays).toBe(7);
    expect(normaliseSettings("custom", { cooldownDays: 3.9 }).cooldownDays).toBe(3);
  });

  it("validCopy rejects blank or oversized text", () => {
    expect(validCopy({ title: "a", body: "b" })).toBe(true);
    expect(validCopy({ title: " ", body: "b" })).toBe(false);
    expect(validCopy({ title: "a", body: "x".repeat(301) })).toBe(false);
    expect(validCopy(undefined)).toBe(false);
  });
});
