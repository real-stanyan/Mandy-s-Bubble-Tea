// Brand, business, and loyalty config for Mandy's Bubble Tea.
// Loyalty rules themselves live in the Square Dashboard — these values
// exist only for UI display (progress bars, labels, etc.).

export const BRAND = {
  name: "Mandy's Bubble Tea",
  primaryColor: "#C43A10", // brick red
  accentColor: "#F5E6C8", // cream
  bgColor: "#F9F6EE", // warm off-white page background
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
  /**
   * Square-hosted loyalty profile page. Customers can add their
   * loyalty card to Apple Wallet from this page.
   * Find yours at: Square Dashboard → Loyalty → Settings → Profile URL
   */
  squareProfileUrl: "https://profile.squareup.com/loyalty/CBASECG-zeMhZlE7OUa1UTJ4XBo",
} as const;
