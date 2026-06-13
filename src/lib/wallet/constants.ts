// Brand tokens for Apple Wallet pass — DIFFERENT from main app (#C43A10)
// per Claude Design handoff. See spec § Visual source of truth.
export const PASS_BRAND = {
  brown: '#8D5524',
  brownDark: '#6E4019',
  sage: '#A2AD91',
  cream: '#FFF9F0',
  peach: '#FFB380', // matches T.peach in the RN StarCupsRow
} as const

export const PASS_BG_RGB = 'rgb(141, 85, 36)'
export const PASS_FG_RGB = 'rgb(255, 255, 255)'
// PassKit only accepts rgb() or #hex (no alpha). Using opaque white for labels.
export const PASS_LABEL_RGB = 'rgb(255, 255, 255)'

export const LOYALTY_REWARD_THRESHOLD = 9

export const STORE_INFO = {
  address: '34 Davenport St, Southport QLD 4215',
  phone: '0404 978 238',
  hours: 'Mon–Sun · 10:00–22:30',
  website: 'https://mandybubbletea.com',
} as const

export const PASS_TERMS =
  'Earn 1 star per drink. 9 stars = 1 free drink of equal or lesser value. ' +
  'Not redeemable for cash. Present pass at checkout or scan to redeem.'

import type { MembershipTier } from "@/lib/membership-tier"

export interface TierStripArt {
  /** Diagonal metal gradient stops: [offset 0..1, css color]. From web TIER_VISUALS base. */
  metal: [number, string][]
  /** Soft top sheen color (rgba). */
  topHighlight: string
  /** Filled-cup fill color (matches web progressFill light stop). */
  cupFill: string
  cupStrokeFilled: string
  cupStrokeEmpty: string
}

export interface TierPassVisual {
  label: "SILVER" | "GOLD" | "DIAMOND"
  backgroundColor: string
  foregroundColor: string
  labelColor: string
  strip: TierStripArt
}

// PassKit accepts only solid rgb()/#hex (no gradients). Background = mid-tone of
// each web tier's base gradient; labelColor = tier accent; strip carries the metal.
export const TIER_PASS: Record<MembershipTier, TierPassVisual> = {
  silver: {
    label: "SILVER",
    backgroundColor: "rgb(58, 64, 78)",
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(205, 212, 224)",
    strip: {
      metal: [[0, "#2c313d"], [0.3, "#485064"], [0.52, "#707a8c"], [0.76, "#414958"], [1, "#2d3340"]],
      topHighlight: "rgba(255,255,255,0.16)",
      cupFill: "#cdd4e0",
      cupStrokeFilled: "rgba(255,255,255,0.95)",
      cupStrokeEmpty: "rgba(255,255,255,0.45)",
    },
  },
  gold: {
    label: "GOLD",
    backgroundColor: "rgb(74, 56, 18)",
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(240, 212, 137)",
    strip: {
      metal: [[0, "#392a0d"], [0.3, "#654c16"], [0.52, "#c2a045"], [0.76, "#574012"], [1, "#322307"]],
      topHighlight: "rgba(255,240,200,0.18)",
      cupFill: "#f0d489",
      cupStrokeFilled: "rgba(255,248,224,0.95)",
      cupStrokeEmpty: "rgba(255,240,200,0.42)",
    },
  },
  diamond: {
    label: "DIAMOND",
    backgroundColor: "rgb(10, 12, 22)",
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(157, 184, 255)",
    strip: {
      metal: [[0, "#04050a"], [0.48, "#10121d"], [1, "#04050a"]],
      topHighlight: "rgba(170,200,255,0.12)",
      cupFill: "#9db8ff",
      cupStrokeFilled: "rgba(210,225,255,0.95)",
      cupStrokeEmpty: "rgba(160,185,235,0.40)",
    },
  },
}
