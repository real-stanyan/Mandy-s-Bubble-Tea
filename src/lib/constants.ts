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

// Platform Fee — additional online-ordering pass-through service charge.
// Same SUBTOTAL_PHASE / non-taxable / skipped-on-free-redeem pattern as
// CARD_SURCHARGE. Customer-visible on every receipt surface.
export const PLATFORM_FEE = {
  name: "Platform Fee",
  /** Percentage as a string — matches Square's OrderServiceCharge.percentage format. */
  percentage: "0.4",
} as const;

/** 0.4% as basis-points-per-10000 for BigInt math: 40 / 10000. */
export const PLATFORM_FEE_BPS = 40n;

// ---- Public holiday surcharge ----

export const PH_SURCHARGE = {
  name: "Public holiday surcharge",
  percentage: "10",
} as const;

/** 10% as basis-points-per-10000 for BigInt math: 1000 / 10000. */
export const PH_SURCHARGE_BPS = 1000n;

export type PublicHolidayDef = {
  name: string;
  date: string;        // YYYY-MM-DD in Brisbane TZ
  startHour?: number;  // Brisbane local hour; default 0 (whole day)
};

// QLD 2026 public holidays.
// TODO: refresh for 2027 before 2026-12-31.
export const PUBLIC_HOLIDAYS_2026: PublicHolidayDef[] = [
  { name: "New Year's Day",        date: "2026-01-01" },
  { name: "Australia Day",         date: "2026-01-26" },
  { name: "Good Friday",           date: "2026-04-03" },
  { name: "Easter Saturday",       date: "2026-04-04" },
  { name: "Easter Sunday",         date: "2026-04-05" },
  { name: "Easter Monday",         date: "2026-04-06" },
  { name: "ANZAC Day",             date: "2026-04-25" },
  { name: "Labour Day",            date: "2026-05-04" },
  { name: "King's Birthday",       date: "2026-10-05" },
  { name: "Christmas Eve",         date: "2026-12-24", startHour: 18 },
  { name: "Christmas Day",         date: "2026-12-25" },
  { name: "Boxing Day",            date: "2026-12-26" },
  { name: "Boxing Day (observed)", date: "2026-12-28" },
];
