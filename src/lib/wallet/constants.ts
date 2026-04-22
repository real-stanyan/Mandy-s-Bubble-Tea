// Brand tokens for Apple Wallet pass — DIFFERENT from main app (#C43A10)
// per Claude Design handoff. See spec § Visual source of truth.
export const PASS_BRAND = {
  brown: '#8D5524',
  brownDark: '#6E4019',
  sage: '#A2AD91',
  cream: '#FFF9F0',
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
