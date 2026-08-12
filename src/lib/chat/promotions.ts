import "server-only";
import { LOYALTY } from "@/lib/constants";
import {
  TIER_DISCOUNT_PERCENT,
  TIER_THRESHOLDS,
  DIAMOND_MONTHLY_FREE_TOPPINGS,
  tierFor,
} from "@/lib/membership-tier";
import { getActiveTastingPromo } from "@/lib/tasting-promo";
import { getActiveFlashPromo } from "@/lib/flash-promo";
import { WEEKLY_SPECIALS } from "@/lib/menu/weekly-specials";

/**
 * What Mandy is allowed to say about promotions, and what she can put on a
 * card. Every fact is read from the same source the site renders from —
 * a second hardcoded copy of a discount is a promise the checkout won't
 * keep, which is the failure this codebase keeps having to design against.
 */
export type PromotionKey =
  | "loyalty"
  | "weekly-specials"
  | "tasting"
  | "flash"
  | "app-download"
  | "ig-follow"
  | "welcome"
  | "tier";

export type Promotion = {
  key: PromotionKey;
  /** Short title for the card. */
  title: string;
  /** One or two sentences the card shows. Server-authored, never model text. */
  detail: string;
  /** The same fact, written for the model instead of for the customer.
   *
   *  `detail` is card copy, and it is Chinese because that is how the site
   *  prints it. Feeding it straight into the system prompt turned the whole
   *  block into a language sample: measured 2026-08-12 over 20 replies per
   *  variant against the live catalog, a signed-out customer asking an
   *  English question got a Chinese answer 4/20 of the time, with nothing
   *  else Chinese anywhere in the prompt. The model cannot tell reference
   *  data from a demonstration, so reference data has to be neutral. The
   *  card keeps its Chinese; only what the model reads changes. */
  promptDetail: string;
  /** Where the card's button sends them, if anywhere. */
  href: string | null;
  /** Button copy; null when the card is informational only. */
  cta: string | null;
};

/** The signed-in customer's own state, when the chat request carried a
 *  session. Absent for a browsing stranger — then everything is explained
 *  in general terms and nothing personal is claimed. */
export type CustomerPromoState = {
  starBalance: number;
  starsPerReward: number;
  lifetimePoints: number;
  welcomeAvailable: boolean;
  igFollowAvailable: boolean;
  igFollowPercentage: number;
  flashAvailable: boolean;
  flashPercentage: number;
  appDownloadAvailable: boolean;
  appDownloadPercentage: number;
};

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Every promotion that is live right now, personalised when we know who is
 * asking. Order matters: the list doubles as what Mandy reads out when a
 * customer asks "有什么活动", so the most immediately useful comes first.
 */
/** The campaign lookups that don't depend on who is asking, so the caller
 *  can run them alongside the menu fetch instead of after it. */
export type PromoCampaigns = {
  tasting: { available: boolean; productName: string | null; tastingPriceCents: number } | null;
  flash: { available: boolean; percentage: number } | null;
};

export async function fetchPromoCampaigns(): Promise<PromoCampaigns> {
  const [tasting, flash] = await Promise.all([
    getActiveTastingPromo().catch(() => null),
    getActiveFlashPromo().catch(() => null),
  ]);
  return { tasting, flash };
}

export async function getLivePromotions(
  customer: CustomerPromoState | null,
  campaigns?: PromoCampaigns,
): Promise<Promotion[]> {
  const out: Promotion[] = [];

  // --- Loyalty: the one customers ask about most ("我可以免费换了吗") ---
  const perReward = customer?.starsPerReward || LOYALTY.starsPerReward;
  if (customer) {
    const redeemable = perReward > 0 ? Math.floor(customer.starBalance / perReward) : 0;
    const toNext = perReward > 0 ? perReward - (customer.starBalance % perReward) : perReward;
    out.push({
      key: "loyalty",
      title: redeemable > 0 ? `你有 ${redeemable} 杯免费饮品` : "集星换免费饮品",
      detail:
        redeemable > 0
          ? `你现在有 ${customer.starBalance} 颗星，可以兑换 ${redeemable} 杯免费饮品（任意口味任意杯型）。在结账页或到店出示会员码即可使用。`
          : `每买一杯饮品得 1 颗星，${perReward} 颗星换 1 杯免费饮品。你现在有 ${customer.starBalance} 颗星，再买 ${toNext} 杯就能换一杯。`,
      promptDetail:
        redeemable > 0
          ? `They have ${customer.starBalance} stars and can redeem ${redeemable} free drink(s) — any flavour, any size — at checkout or in store with their member code.`
          : `One star per drink bought; ${perReward} stars earns a free drink of any flavour and size. They have ${customer.starBalance} stars and need ${toNext} more.`,
      href: redeemable > 0 ? "/account/promotions" : "/menu",
      cta: redeemable > 0 ? "去兑换" : "去点单",
    });
  } else {
    out.push({
      key: "loyalty",
      title: "集星换免费饮品",
      detail: `每买一杯饮品得 1 颗星，${perReward} 颗星换 1 杯免费饮品（任意口味任意杯型）。登录后可以看到自己攒了多少颗。`,
      promptDetail: `One star per drink bought; ${perReward} stars earns a free drink of any flavour and size. Signing in shows them their own balance — you do not know it.`,
      href: "/account",
      cta: "查看我的星星",
    });
  }

  // --- Weekly specials: the shelf on /menu ---
  if (WEEKLY_SPECIALS.length > 0) {
    out.push({
      key: "weekly-specials",
      title: "本周特价",
      detail: `${WEEKLY_SPECIALS.map((s) => s.name).join("、")} —— 本周限时降价，菜单顶部的「WEEKLY SPECIALS」区就能点。`,
      promptDetail: `Discounted this week only: ${WEEKLY_SPECIALS.map((s) => s.name).join(", ")}. They sit in the WEEKLY SPECIALS shelf at the top of the menu.`,
      href: "/menu",
      cta: "看特价",
    });
  }

  // --- Time-boxed campaigns, only while actually running ---
  // Reuses the caller's parallel fetch when it has one; falling back to
  // fetching here keeps the function usable on its own (and in tests).
  const { tasting, flash } = campaigns ?? (await fetchPromoCampaigns());

  if (tasting?.available && tasting.productName) {
    out.push({
      key: "tasting",
      title: `新品尝鲜价 ${money(tasting.tastingPriceCents)}`,
      detail: `${tasting.productName} 尝鲜价 ${money(tasting.tastingPriceCents)}，每单限一杯，结账时自动取用你能享受的最优折扣。`,
      promptDetail: `${tasting.productName} is on an introductory price, one per order, applied at checkout alongside whichever discount works out best for them.`,
      href: "/menu",
      cta: "去尝鲜",
    });
  }

  if (customer?.flashAvailable && customer.flashPercentage > 0) {
    out.push({
      key: "flash",
      title: `限时 ${customer.flashPercentage}% OFF`,
      detail: `你有一张 ${customer.flashPercentage}% 的限时折扣，结账时自动使用。`,
      promptDetail: `They hold a ${customer.flashPercentage}% limited-time discount, applied automatically at checkout.`,
      href: "/menu",
      cta: "去点单",
    });
  }

  if (customer?.welcomeAvailable) {
    out.push({
      key: "welcome",
      title: "新客首单优惠",
      detail: "你的新客优惠还没用，下单时会自动抵扣。",
      promptDetail:
        "Their first-order welcome discount is unused and comes off automatically when they order.",
      href: "/menu",
      cta: "去点单",
    });
  }

  if (customer?.igFollowAvailable && customer.igFollowPercentage > 0) {
    out.push({
      key: "ig-follow",
      title: `关注 Instagram 得 ${customer.igFollowPercentage}% OFF`,
      detail: `关注 @mandysbubbletea 就能领 ${customer.igFollowPercentage}% 折扣，自动打在最便宜的那杯上。`,
      promptDetail: `Following @mandysbubbletea on Instagram earns a ${customer.igFollowPercentage}% discount, applied to the cheapest drink in the order.`,
      href: "/account/promotions",
      cta: "去领取",
    });
  } else if (!customer) {
    out.push({
      key: "ig-follow",
      title: "关注 Instagram 有折扣",
      detail: "关注 @mandysbubbletea 可以领一次性折扣，登录后在「我的优惠」里领取。",
      promptDetail:
        "Following @mandysbubbletea on Instagram earns a one-off discount, claimed under My Offers once signed in.",
      href: "/account",
      cta: "登录查看",
    });
  }

  if (customer?.appDownloadAvailable && customer.appDownloadPercentage > 0) {
    out.push({
      key: "app-download",
      title: `下载 App 首单 ${customer.appDownloadPercentage}% OFF`,
      detail: `在 App 里下单，首单直接减 ${customer.appDownloadPercentage}%，结账时自动生效。`,
      promptDetail: `Their first order placed in the app takes ${customer.appDownloadPercentage}% off, applied automatically at checkout.`,
      href: "/menu",
      cta: "去点单",
    });
  }

  // --- Membership tiers: always true, worth explaining on request ---
  const tier = customer ? tierFor(customer.lifetimePoints) : null;
  out.push({
    key: "tier",
    title: tier ? `你的会员等级：${tierLabel(tier)}` : "会员等级",
    detail: tier
      ? tierDetail(tier, customer!.lifetimePoints)
      : `累计买满 ${TIER_THRESHOLDS.gold} 杯升黄金、${TIER_THRESHOLDS.diamond} 杯升钻石。黄金和钻石会员每单享 ${TIER_DISCOUNT_PERCENT}% 折扣，钻石会员每月还有 ${DIAMOND_MONTHLY_FREE_TOPPINGS} 份免费小料。`,
    promptDetail: tier
      ? tierPromptDetail(tier, customer!.lifetimePoints)
      : `${TIER_THRESHOLDS.gold} drinks bought lifetime reaches Gold, ${TIER_THRESHOLDS.diamond} reaches Diamond. Gold and Diamond take ${TIER_DISCOUNT_PERCENT}% off every order; Diamond also gets ${DIAMOND_MONTHLY_FREE_TOPPINGS} free toppings a month.`,
    href: "/account",
    cta: "查看会员",
  });

  return out;
}

function tierLabel(tier: "silver" | "gold" | "diamond"): string {
  return tier === "diamond" ? "钻石" : tier === "gold" ? "黄金" : "白银";
}

function tierDetail(tier: "silver" | "gold" | "diamond", lifetime: number): string {
  if (tier === "diamond") {
    return `钻石会员：每单 ${TIER_DISCOUNT_PERCENT}% 折扣，每月 ${DIAMOND_MONTHLY_FREE_TOPPINGS} 份免费小料。`;
  }
  if (tier === "gold") {
    return `黄金会员：每单 ${TIER_DISCOUNT_PERCENT}% 折扣。再买 ${TIER_THRESHOLDS.diamond - lifetime} 杯升钻石，每月还能拿 ${DIAMOND_MONTHLY_FREE_TOPPINGS} 份免费小料。`;
  }
  return `白银会员。再买 ${TIER_THRESHOLDS.gold - lifetime} 杯升黄金，每单就有 ${TIER_DISCOUNT_PERCENT}% 折扣。`;
}

function tierPromptDetail(tier: "silver" | "gold" | "diamond", lifetime: number): string {
  if (tier === "diamond") {
    return `Diamond member: ${TIER_DISCOUNT_PERCENT}% off every order, plus ${DIAMOND_MONTHLY_FREE_TOPPINGS} free toppings a month.`;
  }
  if (tier === "gold") {
    return `Gold member: ${TIER_DISCOUNT_PERCENT}% off every order. ${TIER_THRESHOLDS.diamond - lifetime} more drinks reaches Diamond, which adds ${DIAMOND_MONTHLY_FREE_TOPPINGS} free toppings a month.`;
  }
  return `Silver member. ${TIER_THRESHOLDS.gold - lifetime} more drinks reaches Gold, which is ${TIER_DISCOUNT_PERCENT}% off every order.`;
}

/** How close this customer is to their next free drink, when close enough
 *  to be worth saying out loud unprompted.
 *
 *  61.9% of orders over the last 90 days were a single drink. The cheapest
 *  honest way to move that is not a sales pitch — it is telling someone who
 *  is one cup from a free drink that they are one cup from a free drink.
 *  That is information they want and cannot see mid-conversation, and it
 *  happens to be the moment it is most useful.
 *
 *  Only 1–2 away qualifies. At three or more it stops being news and starts
 *  being pressure, which costs more than it earns.
 *
 *  Carries no sample sentence, for the same reason promptDetail exists: the
 *  first version demonstrated the line in Chinese and the model copied the
 *  language instead of the instruction. */
export function nearRewardNudge(customer: CustomerPromoState | null): string | null {
  if (!customer) return null;
  const per = customer.starsPerReward || LOYALTY.starsPerReward;
  if (per <= 0) return null;
  const toNext = per - (customer.starBalance % per);
  if (toNext > 2 || toNext === per) return null;
  return `This customer is ${toNext} star${toNext === 1 ? "" : "s"} away from a free drink (they have ${customer.starBalance}). Mention it ONCE, in passing, while helping them order, and never repeat it in the same conversation. Do not turn it into a pitch: say it once and get on with their order.`;
}

/** The block that goes in the system prompt: what is running, in Mandy's
 *  own reading order, plus the customer's own numbers when we have them.
 *
 *  Reads promptDetail, never detail — see the field's own comment. */
export function buildPromotionsDigest(
  promotions: Promotion[],
  nudge: string | null = null,
): string {
  if (promotions.length === 0 && !nudge) return "";
  const lines = promotions.map((p) => `- [${p.key}] ${p.promptDetail}`);
  const head = `LIVE PROMOTIONS (these are the ONLY promotions; never invent one, never quote a discount that is not listed here)
${lines.join("\n")}`;
  return nudge ? `${head}\n\nNEARLY THERE\n${nudge}` : head;
}
