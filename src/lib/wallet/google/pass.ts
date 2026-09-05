// Google Wallet loyalty class + object for the member card.
//
// Pure builders — no I/O — so the card's content can be unit-tested the way
// pass.ts is for Apple. The two cards must read the same: same member number,
// same "N/9" stars, same tier line, same QR payload (E.164 phone, which the
// POS looks up). Where PassKit has a strip PNG, Google has a hero image; we
// serve the very same rendered strip at a public URL and point the object at
// it, so tier colour + cup progress carry over without a second art pipeline.
//
// Google's rules that shape this file:
//   - ids: "<issuerId>.<suffix>", suffix limited to [A-Za-z0-9._-]
//   - hexBackgroundColor lives on the CLASS, so one class = one background.
//     Tier colour therefore lives in the hero strip, not the card ground.
//   - accountName / accountId / labels are recommended ≤ 20 chars.
//   - reviewStatus is required on the class; UNDER_REVIEW until Google
//     approves the issuer for publishing.

import { tierProgress, TIER_DISCOUNT_PERCENT, type MembershipTier } from "@/lib/membership-tier"
import { PASS_TERMS, STORE_INFO, TIER_PASS } from "../constants"

export const GOOGLE_CLASS_SUFFIX = "mandys-member-card"
export const GOOGLE_PROGRAM_NAME = "Mandy's Rewards"
export const GOOGLE_ISSUER_NAME = "Mandy's Bubble Tea"
/** Card ground: brand ink, the same dark the app's pinned chips use. */
export const GOOGLE_CARD_BACKGROUND = "#2A1E14"

const GOAL = 9

export interface GoogleObjectInput {
  serialNumber: string
  memberNumber: string
  memberName: string
  memberSince: string
  phoneE164: string
  stars: number
  lifetimePoints: number
  availableRewards: number
}

export interface LocalizedString {
  defaultValue: { language: string; value: string }
}

export interface WalletImage {
  sourceUri: { uri: string }
  contentDescription?: LocalizedString
}

export interface LoyaltyClass {
  id: string
  issuerName: string
  programName: string
  programLogo: WalletImage
  hexBackgroundColor: string
  reviewStatus: "UNDER_REVIEW" | "APPROVED" | "DRAFT"
  countryCode: string
  homepageUri: { uri: string; description: string }
  localizedProgramName?: LocalizedString
}

export interface LoyaltyObject {
  id: string
  classId: string
  state: "ACTIVE"
  accountId: string
  accountName: string
  loyaltyPoints: { label: string; balance: { string: string } }
  secondaryLoyaltyPoints: { label: string; balance: { string: string } }
  barcode: { type: "QR_CODE"; value: string; alternateText: string }
  heroImage: WalletImage
  textModulesData: { id: string; header: string; body: string }[]
  linksModuleData: { uris: { id: string; uri: string; description: string }[] }
}

export function googleClassId(issuerId: string): string {
  return `${issuerId}.${GOOGLE_CLASS_SUFFIX}`
}

/** Serial numbers are `mb-4182-9f3a1c2d` — already inside Google's charset. */
export function googleObjectId(issuerId: string, serialNumber: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(serialNumber)) {
    throw new Error(`googleObjectId: serial contains characters Google rejects: ${serialNumber}`)
  }
  return `${issuerId}.${serialNumber}`
}

export function logoUrl(origin: string): string {
  return `${origin}/wallet/google-logo.png`
}

/** Public PNG of the tier strip for a given cycle progress; cache-busts by URL. */
export function heroUrl(origin: string, tier: MembershipTier, stars: number): string {
  return `${origin}/api/wallet/google/hero/${tier}/${stars}.png`
}

function en(value: string): LocalizedString {
  return { defaultValue: { language: "en", value } }
}

export function buildLoyaltyClass(issuerId: string, origin: string): LoyaltyClass {
  return {
    id: googleClassId(issuerId),
    issuerName: GOOGLE_ISSUER_NAME,
    programName: GOOGLE_PROGRAM_NAME,
    programLogo: { sourceUri: { uri: logoUrl(origin) }, contentDescription: en("Mandy's Bubble Tea") },
    hexBackgroundColor: GOOGLE_CARD_BACKGROUND,
    reviewStatus: "UNDER_REVIEW",
    countryCode: "AU",
    homepageUri: { uri: STORE_INFO.website, description: "Order ahead" },
    localizedProgramName: en(GOOGLE_PROGRAM_NAME),
  }
}

function tierDisplayName(t: MembershipTier): string {
  return t === "gold" ? "Gold" : t === "diamond" ? "Diamond" : "Silver"
}

export function buildLoyaltyObject(
  issuerId: string,
  origin: string,
  i: GoogleObjectInput,
): LoyaltyObject {
  const { tier, nextTier, starsToNext } = tierProgress(i.lifetimePoints)
  const cycleStars = ((i.stars % GOAL) + GOAL) % GOAL
  const toGo = Math.max(0, GOAL - cycleStars)
  const rewardText = i.availableRewards > 0 ? "Ready to redeem!" : `${toGo} stars to go`

  // Mirrors pass.ts: silver/gold count down to the next tier, diamond is static.
  const status =
    tier === "diamond" || nextTier == null || starsToNext == null
      ? { id: "status", header: "STATUS", body: "Top tier member" }
      : { id: "status", header: "NEXT TIER", body: `${starsToNext} to ${tierDisplayName(nextTier)}` }

  const textModulesData = [
    { id: "reward", header: "NEXT REWARD", body: rewardText },
    status,
    { id: "since", header: "MEMBER SINCE", body: i.memberSince },
  ]
  if (tier === "diamond") {
    textModulesData.push({
      id: "perks",
      header: "DIAMOND PERKS",
      body: `${TIER_DISCOUNT_PERCENT}% off all orders + free toppings each month`,
    })
  }
  textModulesData.push({ id: "terms", header: "TERMS", body: PASS_TERMS })

  return {
    id: googleObjectId(issuerId, i.serialNumber),
    classId: googleClassId(issuerId),
    state: "ACTIVE",
    accountId: i.memberNumber,
    accountName: i.memberName.slice(0, 20),
    loyaltyPoints: { label: "Stars", balance: { string: `${cycleStars}/${GOAL}` } },
    secondaryLoyaltyPoints: { label: "Tier", balance: { string: TIER_PASS[tier].label } },
    barcode: { type: "QR_CODE", value: i.phoneE164, alternateText: i.memberNumber },
    heroImage: {
      sourceUri: { uri: heroUrl(origin, tier, cycleStars) },
      contentDescription: en(`${cycleStars} of ${GOAL} stars`),
    },
    textModulesData,
    linksModuleData: {
      uris: [
        { id: "web", uri: STORE_INFO.website, description: "Order ahead" },
        { id: "tel", uri: `tel:${STORE_INFO.phone.replace(/\s+/g, "")}`, description: "Call the store" },
      ],
    },
  }
}
