// Brand, business, and loyalty config for Mandy's Bubble Tea.
// Loyalty rules themselves live in the Square Dashboard — these values
// exist only for UI display (progress bars, labels, etc.).

export const BRAND = {
  name: "Mandy's Bubble Tea",
  primaryColor: "#8D5524", // warm brown (aligned with RN app)
  accentColor: "#FFF3DE", // cream
  bgColor: "#F2E8DF", // warm beige page background
} as const;

// ---- Limited-time campaigns ----
// Homepage "Buy 2 drinks, get a fragrance-tag blind box" promo. Flip to
// false to retire the campaign — the homepage section disappears with no
// other cleanup needed.
export const FRAGRANCE_BLIND_BOX_PROMO = false;

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
  percentage: "0.5",
} as const;

/** 0.5% as basis-points-per-10000 for BigInt math: 50 / 10000. */
export const PLATFORM_FEE_BPS = 50n;

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

// ---- Delivery (self-delivery by store staff) ----

export const DELIVERY = {
  // Pricing model (2026-07-04, per-km bands, +$1 each km):
  //  • 0–4km : free at/above $35, else 0–2km $3.99 / 2–3km $4.99 / 3–4km $5.99.
  //  • 4–8km : free at/above $50, else 4–5km $6.99 / 5–6km $7.99 / 6–7km $8.99 / 7–8km $9.99.
  //  • 8km+  : flat $15, NEVER free regardless of subtotal.
  // First tier whose maxKm >= distance wins; beyond the last tier → farFeeCents.
  tiers: [
    { maxKm: 2, feeCents: 399n, freeAtCents: 3500n },
    { maxKm: 3, feeCents: 499n, freeAtCents: 3500n },
    { maxKm: 4, feeCents: 599n, freeAtCents: 3500n },
    { maxKm: 5, feeCents: 699n, freeAtCents: 5000n },
    { maxKm: 6, feeCents: 799n, freeAtCents: 5000n },
    { maxKm: 7, feeCents: 899n, freeAtCents: 5000n },
    { maxKm: 8, feeCents: 999n, freeAtCents: 5000n },
  ],
  farFeeCents: 1500n,             // 8km+, flat, never waived
  maxKm: 10,                      // delivery radius (straight-line km)
  minimumSubtotalCents: 1200n,    // $12 minimum order
  serviceFeeBps: 500n,            // 5% × drinks subtotal
  hoursOpen: 10.5,                // 10:30 Brisbane
  hoursClose: 22.5,               // 22:30 Brisbane (decimal hour)
} as const;

// Delivery zone — only these postcodes can be delivered to. Replaces the
// straight-line radius gate (some of these sit beyond 10km). Source of truth
// for both client-side form validation and server-authoritative checks.
export const DELIVERABLE_POSTCODES = [
  "4211",
  "4214",
  "4215",
  "4216",
  "4217",
  "4218",
] as const;

export const SERVICE_FEE = {
  name: "Service Fee",
  percentage: "5",
} as const;

export const DELIVERY_FEE_NAME = "Delivery Fee";

// Mandy's Bubble Tea — 34 Davenport St, Southport QLD 4215.
// Geocoded 2026-06-03 (OSM/Nominatim) — the prior placeholder (-28.0084)
// was ~4.6 km too far south, which skewed both the live-tracking store pin
// and the free-delivery distance check in places.ts.
export const STORE_LAT = -27.9660;
export const STORE_LNG = 153.4115;

// Google Maps Place ID for the store (resolved 2026-06-17 via Find Place;
// CID 15758058253926164700 matches the public Maps listing). Used to fetch
// the live store rating shown on the home hero. See lib/store-rating.ts.
export const STORE_PLACE_ID = "ChIJZZ8UjvIPkWsR3Ggu_33er9o";

// Self-delivery driver shown on the customer's live-tracking card (Uber-Eats
// style). Single store driver for now — update here if the driver changes.
// `phone` is digits-only for the tel: link; `phoneDisplay` is what we render.
export const DELIVERY_DRIVER = {
  name: "Rick Zhang",
  phone: "+61404978238",
  phoneDisplay: "+61 404 978 238",
};
