import { describe, it, expect, vi, beforeEach } from "vitest"

const mockWelcome = vi.fn()
const mockIg = vi.fn()
vi.mock("@/lib/supabase", () => ({
  consumeWelcomeDiscount: (...a: unknown[]) => mockWelcome(...a),
}))
vi.mock("@/lib/ig-follow-discount", () => ({
  consumeIgFollowDiscount: (...a: unknown[]) => mockIg(...a),
}))

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
})
