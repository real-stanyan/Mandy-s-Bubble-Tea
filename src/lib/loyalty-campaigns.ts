// Loyalty marketing campaign definitions — pure data and pure functions.
//
// Deliberately free of `server-only`, Square, and Supabase imports: the
// admin client component renders this copy, and the tests assert the
// audience predicates without needing any credentials. Everything that
// touches the network lives in `loyalty-campaigns.server.ts`.

export type CampaignId = "redeem_ready" | "near_threshold";

export type CampaignCopy = {
  titleSingular: string;
  bodySingular: string;
  /** `{n}` is substituted with the customer's count. */
  titlePlural: string;
  bodyPlural: string;
};

export type CampaignDef = {
  id: CampaignId;
  label: string;
  description: string;
  /** Deep link the notification opens in the app. */
  route: string;
  defaultCooldownDays: number;
  defaultCopy: CampaignCopy;
  /**
   * Given a balance and the program's stars-per-reward, return the number
   * this campaign personalises on (free drinks available / drinks still
   * needed), or null when the customer is not in the audience.
   */
  match: (balance: number, starsPerReward: number) => number | null;
};

export const CAMPAIGNS: Record<CampaignId, CampaignDef> = {
  redeem_ready: {
    id: "redeem_ready",
    label: "Free drink ready to redeem",
    description:
      "Customers whose balance already covers at least one free drink but who haven't redeemed it.",
    route: "/account",
    defaultCooldownDays: 14,
    defaultCopy: {
      titleSingular: "🧋 A free drink is waiting for you",
      bodySingular:
        "You've got enough stars for a free drink. Come redeem it on your next visit!",
      titlePlural: "🧋 {n} free drinks waiting",
      bodyPlural:
        "You've got enough stars for {n} free drinks. Come redeem them before they slip your mind!",
    },
    match: (balance, starsPerReward) => {
      if (balance < starsPerReward) return null;
      return Math.floor(balance / starsPerReward);
    },
  },
  near_threshold: {
    id: "near_threshold",
    label: "One or two drinks short",
    description:
      "Customers 1-2 stars away from a free drink — the nudge with the shortest path to a repeat visit.",
    route: "/account",
    defaultCooldownDays: 21,
    defaultCopy: {
      titleSingular: "🧋 1 more drink and it's on us",
      bodySingular:
        "You're one star away from a free drink. One more order and it's yours!",
      titlePlural: "🧋 {n} more drinks and it's on us",
      bodyPlural:
        "You're {n} stars away from a free drink. A couple more visits and it's yours!",
    },
    match: (balance, starsPerReward) => {
      const deficit = starsPerReward - balance;
      return deficit >= 1 && deficit <= 2 ? deficit : null;
    },
  },
};

export function renderCopy(
  copy: CampaignCopy,
  n: number,
): { title: string; body: string } {
  if (n === 1) {
    return { title: copy.titleSingular, body: copy.bodySingular };
  }
  return {
    title: copy.titlePlural.replaceAll("{n}", String(n)),
    body: copy.bodyPlural.replaceAll("{n}", String(n)),
  };
}

export type Recipient = {
  phone: string;
  token: string;
  /** Free drinks available, or drinks still needed — campaign-dependent. */
  n: number;
};

export type Audience = {
  starsPerReward: number;
  /** Phones matching the balance predicate, whether or not they have the app. */
  eligiblePhones: number;
  /** Of those, phones with at least one push token. */
  reachablePhones: number;
  /** Reachable phones held back by the cooldown. */
  suppressedPhones: number;
  /** Devices that will actually be pushed. */
  recipients: Recipient[];
  /** Per-`n` grouping, for the admin preview. */
  breakdown: Array<{ n: number; phones: number }>;
};
