import { describe, it, expect } from "vitest"
import {
  buildLoyaltyClass,
  buildLoyaltyObject,
  googleClassId,
  googleObjectId,
  heroUrl,
  GOOGLE_CARD_BACKGROUND,
} from "./pass"
import { PASS_TERMS } from "../constants"

const ISSUER = "3388000000023193709"
const ORIGIN = "https://mandybubbletea.com"

const base = {
  serialNumber: "mb-4182-abcdef12",
  memberNumber: "MB-4182",
  memberName: "Stan Yan",
  memberSince: "May 2024",
  phoneE164: "+61404978238",
  stars: 7,
  lifetimePoints: 71,
  availableRewards: 0,
}

describe("ids", () => {
  it("prefix the issuer id", () => {
    expect(googleClassId(ISSUER)).toBe(`${ISSUER}.mandys-member-card`)
    expect(googleObjectId(ISSUER, "mb-4182-abcdef12")).toBe(`${ISSUER}.mb-4182-abcdef12`)
  })
  it("reject serials outside Google's charset", () => {
    expect(() => googleObjectId(ISSUER, "mb 4182")).toThrow()
  })
})

describe("buildLoyaltyClass", () => {
  it("is a single, under-review class with the brand ground and a public logo", () => {
    const cls = buildLoyaltyClass(ISSUER, ORIGIN)
    expect(cls.id).toBe(googleClassId(ISSUER))
    expect(cls.reviewStatus).toBe("UNDER_REVIEW")
    expect(cls.hexBackgroundColor).toBe(GOOGLE_CARD_BACKGROUND)
    expect(cls.programLogo.sourceUri.uri).toBe(`${ORIGIN}/wallet/google-logo.png`)
    expect(cls.countryCode).toBe("AU")
    expect(cls.issuerName.length).toBeLessThanOrEqual(20)
    expect(cls.programName.length).toBeLessThanOrEqual(20)
  })
})

describe("buildLoyaltyObject", () => {
  it("carries the same identity + QR payload as the Apple pass", () => {
    const o = buildLoyaltyObject(ISSUER, ORIGIN, base)
    expect(o.id).toBe(`${ISSUER}.mb-4182-abcdef12`)
    expect(o.classId).toBe(googleClassId(ISSUER))
    expect(o.state).toBe("ACTIVE")
    expect(o.accountId).toBe("MB-4182")
    expect(o.accountName).toBe("Stan Yan")
    expect(o.barcode).toEqual({ type: "QR_CODE", value: "+61404978238", alternateText: "MB-4182" })
  })

  it("shows cycle stars as N/9 and the tier as the secondary balance", () => {
    const o = buildLoyaltyObject(ISSUER, ORIGIN, base)
    expect(o.loyaltyPoints).toEqual({ label: "Stars", balance: { string: "7/9" } })
    expect(o.secondaryLoyaltyPoints).toEqual({ label: "Tier", balance: { string: "GOLD" } })
    expect(o.heroImage.sourceUri.uri).toBe(heroUrl(ORIGIN, "gold", 7))
  })

  it("derives tier from lifetime points at the same boundaries as the web card", () => {
    const silver = buildLoyaltyObject(ISSUER, ORIGIN, { ...base, lifetimePoints: 29 })
    const gold = buildLoyaltyObject(ISSUER, ORIGIN, { ...base, lifetimePoints: 30 })
    const diamond = buildLoyaltyObject(ISSUER, ORIGIN, { ...base, lifetimePoints: 80 })
    expect(silver.secondaryLoyaltyPoints.balance.string).toBe("SILVER")
    expect(gold.secondaryLoyaltyPoints.balance.string).toBe("GOLD")
    expect(diamond.secondaryLoyaltyPoints.balance.string).toBe("DIAMOND")
    expect(silver.heroImage.sourceUri.uri).toContain("/hero/silver/")
    expect(diamond.heroImage.sourceUri.uri).toContain("/hero/diamond/")
  })

  it("text modules mirror the Apple fields: reward, next tier, since, terms", () => {
    const o = buildLoyaltyObject(ISSUER, ORIGIN, base)
    const byId = Object.fromEntries(o.textModulesData.map((m) => [m.id, m]))
    expect(byId.reward.body).toBe("2 stars to go")
    expect(byId.status.header).toBe("NEXT TIER")
    expect(byId.status.body).toBe("9 to Diamond")
    expect(byId.since.body).toBe("May 2024")
    expect(byId.terms.body).toBe(PASS_TERMS)
    expect(byId.perks).toBeUndefined()
  })

  it("diamond members get a static status line and the perks module", () => {
    const o = buildLoyaltyObject(ISSUER, ORIGIN, { ...base, lifetimePoints: 120, stars: 0, availableRewards: 1 })
    const byId = Object.fromEntries(o.textModulesData.map((m) => [m.id, m]))
    expect(byId.status).toEqual({ id: "status", header: "STATUS", body: "Top tier member" })
    expect(byId.perks.body).toContain("5% off")
    expect(byId.reward.body).toBe("Ready to redeem!")
    expect(o.loyaltyPoints.balance.string).toBe("0/9")
  })

  it("keeps the hero in range when stars exceed the 9-cup cycle", () => {
    const o = buildLoyaltyObject(ISSUER, ORIGIN, { ...base, stars: 11 })
    expect(o.loyaltyPoints.balance.string).toBe("2/9")
    expect(o.heroImage.sourceUri.uri).toMatch(/\/hero\/gold\/2\.png$/)
  })

  it("trims long names to Google's 20-character guidance", () => {
    const o = buildLoyaltyObject(ISSUER, ORIGIN, { ...base, memberName: "Bartholomew Featherstonehaugh" })
    expect(o.accountName.length).toBe(20)
  })
})
