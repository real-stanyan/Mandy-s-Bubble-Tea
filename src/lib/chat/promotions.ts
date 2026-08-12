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
export async function getLivePromotions(
  customer: CustomerPromoState | null,
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
      href: redeemable > 0 ? "/account/promotions" : "/menu",
      cta: redeemable > 0 ? "去兑换" : "去点单",
    });
  } else {
    out.push({
      key: "loyalty",
      title: "集星换免费饮品",
      detail: `每买一杯饮品得 1 颗星，${perReward} 颗星换 1 杯免费饮品（任意口味任意杯型）。登录后可以看到自己攒了多少颗。`,
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
      href: "/menu",
      cta: "看特价",
    });
  }

  // --- Time-boxed campaigns, only while actually running ---
  const [tasting, flash] = await Promise.all([
    getActiveTastingPromo().catch(() => null),
    getActiveFlashPromo().catch(() => null),
  ]);

  if (tasting?.available && tasting.productName) {
    out.push({
      key: "tasting",
      title: `新品尝鲜价 ${money(tasting.tastingPriceCents)}`,
      detail: `${tasting.productName} 尝鲜价 ${money(tasting.tastingPriceCents)}，每单限一杯，结账时自动取用你能享受的最优折扣。`,
      href: "/menu",
      cta: "去尝鲜",
    });
  }

  if (customer?.flashAvailable && customer.flashPercentage > 0) {
    out.push({
      key: "flash",
      title: `限时 ${customer.flashPercentage}% OFF`,
      detail: `你有一张 ${customer.flashPercentage}% 的限时折扣，结账时自动使用。`,
      href: "/menu",
      cta: "去点单",
    });
  }

  if (customer?.welcomeAvailable) {
    out.push({
      key: "welcome",
      title: "新客首单优惠",
      detail: "你的新客优惠还没用，下单时会自动抵扣。",
      href: "/menu",
      cta: "去点单",
    });
  }

  if (customer?.igFollowAvailable && customer.igFollowPercentage > 0) {
    out.push({
      key: "ig-follow",
      title: `关注 Instagram 得 ${customer.igFollowPercentage}% OFF`,
      detail: `关注 @mandysbubbletea 就能领 ${customer.igFollowPercentage}% 折扣，自动打在最便宜的那杯上。`,
      href: "/account/promotions",
      cta: "去领取",
    });
  } else if (!customer) {
    out.push({
      key: "ig-follow",
      title: "关注 Instagram 有折扣",
      detail: "关注 @mandysbubbletea 可以领一次性折扣，登录后在「我的优惠」里领取。",
      href: "/account",
      cta: "登录查看",
    });
  }

  if (customer?.appDownloadAvailable && customer.appDownloadPercentage > 0) {
    out.push({
      key: "app-download",
      title: `下载 App 首单 ${customer.appDownloadPercentage}% OFF`,
      detail: `在 App 里下单，首单直接减 ${customer.appDownloadPercentage}%，结账时自动生效。`,
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

/** The block that goes in the system prompt: what is running, in Mandy's
 *  own reading order, plus the customer's own numbers when we have them. */
export function buildPromotionsDigest(promotions: Promotion[]): string {
  if (promotions.length === 0) return "";
  const lines = promotions.map((p) => `- [${p.key}] ${p.title} — ${p.detail}`);
  return `LIVE PROMOTIONS (these are the ONLY promotions; never invent one, never quote a discount that is not listed here)
${lines.join("\n")}`;
}
