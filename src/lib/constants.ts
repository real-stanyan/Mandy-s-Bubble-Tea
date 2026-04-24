// Brand, business, and loyalty config for Mandy's Bubble Tea.
// Loyalty rules themselves live in the Square Dashboard — these values
// exist only for UI display (progress bars, labels, etc.).

export const BRAND = {
  name: "Mandy's Bubble Tea",
  primaryColor: "#8D5524", // warm brown (aligned with RN app)
  accentColor: "#FFF3DE", // cream
  bgColor: "#F2E8DF", // warm beige page background
} as const;

export const BUSINESS = {
  name: "Mandy's Bubble Tea",
  address: "34 Davenport St, Southport QLD 4215",
  phone: "0404 978 238",
  domain: "mandybubbletea.com",
  timezone: "Australia/Brisbane",
  currency: "AUD",
} as const;

/** Catalog categories eligible to earn loyalty stars. */
export const LOYALTY_CATEGORIES = [
  "MILKY",
  "FRUITY",
  "SPECIAL MIX",
  "FRESH BREW",
  "FRUITY BLACK TEA",
  "FROZEN",
  "CHEESE CREAM",
] as const;

export const LOYALTY = {
  /** Stars required for a free drink reward. */
  starsPerReward: 9,
  /** Display unit. */
  unit: "⭐",
  rewardLabel: "Free Drink of Your Choice",
} as const;

// Passes Square card-processing fees through to the customer. Applied
// as a Square service charge in SUBTOTAL_PHASE so it's computed on the
// pre-discount subtotal and shows up on all Square surfaces (POS,
// Dashboard, receipts, webhooks) automatically.
export const CARD_SURCHARGE = {
  name: "Card Surcharge",
  /** Percentage as a string — matches Square's OrderServiceCharge.percentage format. */
  percentage: "1.9",
} as const;

/** 1.9% as basis-points-per-10000 for BigInt math: 190 / 10000. */
export const CARD_SURCHARGE_BPS = 190n;
