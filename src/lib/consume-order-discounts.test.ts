import { describe, it, expect, vi, beforeEach } from "vitest"

const mockWelcome = vi.fn()
const mockIg = vi.fn()
const mockTopping = vi.fn()
vi.mock("@/lib/supabase", () => ({
  consumeWelcomeDiscount: (...a: unknown[]) => mockWelcome(...a),
}))
vi.mock("@/lib/ig-follow-discount", () => ({
  consumeIgFollowDiscount: (...a: unknown[]) => mockIg(...a),
}))
vi.mock("@/lib/tier-toppings-store", () => ({
  consumeToppingAllowance: (...a: unknown[]) => mockTopping(...a),
}))
vi.mock("@/lib/membership-tier", () => ({
  brisbaneMonthKey: () => "2026-07",
}))
const mockFlash = vi.fn()
vi.mock("@/lib/flash-promo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./flash-promo")>()
  return {
    flashPromoKeyFromDiscounts: actual.flashPromoKeyFromDiscounts,
    consumeFlashPromo: (...a: unknown[]) => mockFlash(...a),
  }
})

import { consumeOrderDiscounts } from "./consume-order-discounts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const order = (o: Record<string, unknown>): any => o

describe("consumeOrderDiscounts", () => {
  beforeEach(() => vi.clearAllMocks())

  it("burns the welcome discount with the covered count", async () => {
    await consumeOrderDiscounts(
      order({
        id: "O1",
        customerId: "C1",
        discounts: [{ uid: "welcome-discount" }],
        metadata: { welcomeDiscountDrinksCovered: "2" },
      }),
    )
    expect(mockWelcome).toHaveBeenCalledWith("C1", "O1", 2)
    expect(mockIg).not.toHaveBeenCalled()
  })

  it("burns the ig-follow discount", async () => {
    await consumeOrderDiscounts(
      order({
        id: "O1",
        customerId: "C1",
        discounts: [{ uid: "ig-follow-discount" }],
        metadata: { igFollowDiscountDrinksCovered: "1" },
      }),
    )
    expect(mockIg).toHaveBeenCalledWith("C1", "O1", 1)
    expect(mockWelcome).not.toHaveBeenCalled()
  })

  it("no-ops when no discount applies", async () => {
    await consumeOrderDiscounts(
      order({ id: "O1", customerId: "C1", discounts: [], metadata: {} }),
    )
    expect(mockWelcome).not.toHaveBeenCalled()
    expect(mockIg).not.toHaveBeenCalled()
  })

  it("no-ops without a customer (cannot attribute consumption)", async () => {
    await consumeOrderDiscounts(
      order({
        id: "O1",
        customerId: undefined,
        discounts: [{ uid: "welcome-discount" }],
        metadata: { welcomeDiscountDrinksCovered: "2" },
      }),
    )
    expect(mockWelcome).not.toHaveBeenCalled()
  })

  it("ignores a discount with a zero / missing covered count", async () => {
    await consumeOrderDiscounts(
      order({
        id: "O1",
        customerId: "C1",
        discounts: [{ uid: "welcome-discount" }],
        metadata: {},
      }),
    )
    expect(mockWelcome).not.toHaveBeenCalled()
  })

  it("burns the tier topping allowance with the covered count and Brisbane month", async () => {
    await consumeOrderDiscounts(
      order({
        id: "O1",
        customerId: "C1",
        discounts: [{ uid: "tier-topping-allowance" }],
        metadata: { tierToppingsCovered: "7" },
      }),
    )
    expect(mockTopping).toHaveBeenCalledWith("C1", "2026-07", 7, "O1")
    expect(mockTopping).toHaveBeenCalledTimes(1)
  })

  it("does not burn the topping allowance when that discount is absent", async () => {
    await consumeOrderDiscounts(
      order({
        id: "O1",
        customerId: "C1",
        discounts: [{ uid: "welcome-discount" }],
        metadata: { welcomeDiscountDrinksCovered: "2" },
      }),
    )
    expect(mockTopping).not.toHaveBeenCalled()
  })

  it("ignores the topping allowance with a zero / missing covered count", async () => {
    await consumeOrderDiscounts(
      order({
        id: "O1",
        customerId: "C1",
        discounts: [{ uid: "tier-topping-allowance" }],
        metadata: {},
      }),
    )
    expect(mockTopping).not.toHaveBeenCalled()
  })

  it('ignores the topping allowance when covered is the string "0"', async () => {
    await consumeOrderDiscounts(
      order({
        id: "O1",
        customerId: "C1",
        discounts: [{ uid: "tier-topping-allowance" }],
        metadata: { tierToppingsCovered: "0" },
      }),
    )
    expect(mockTopping).not.toHaveBeenCalled()
  })

  it("burns welcome and tier-topping independently in one order", async () => {
    await consumeOrderDiscounts(
      order({
        id: "O1",
        customerId: "C1",
        discounts: [
          { uid: "welcome-discount" },
          { uid: "tier-topping-allowance" },
        ],
        metadata: { welcomeDiscountDrinksCovered: "2", tierToppingsCovered: "5" },
      }),
    )
    expect(mockWelcome).toHaveBeenCalledWith("C1", "O1", 2)
    expect(mockTopping).toHaveBeenCalledWith("C1", "2026-07", 5, "O1")
  })

  it("burns the flash promo with the key parsed from the discount uid", async () => {
    await consumeOrderDiscounts(
      order({
        id: "O1",
        customerId: "C1",
        discounts: [{ uid: "flash-promo:flash-2026-07-17" }],
        metadata: {},
      }),
    )
    expect(mockFlash).toHaveBeenCalledWith("flash-2026-07-17", "C1", "O1")
  })

  it("skips the flash promo burn when no flash discount is attached", async () => {
    await consumeOrderDiscounts(
      order({
        id: "O1",
        customerId: "C1",
        discounts: [{ uid: "welcome-discount" }],
        metadata: { welcomeDiscountDrinksCovered: "1" },
      }),
    )
    expect(mockFlash).not.toHaveBeenCalled()
  })
})
