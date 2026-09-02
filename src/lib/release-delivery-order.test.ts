import { describe, it, expect, vi, beforeEach } from "vitest"

const mockOrdersGet = vi.fn()
const mockOrdersUpdate = vi.fn()
const mockPaymentsCancel = vi.fn()
vi.mock("@/lib/square", () => ({
  squareClient: {
    orders: {
      get: (...a: unknown[]) => mockOrdersGet(...a),
      update: (...a: unknown[]) => mockOrdersUpdate(...a),
    },
    payments: { cancel: (...a: unknown[]) => mockPaymentsCancel(...a) },
  },
  SQUARE_LOCATION_ID: "L1",
}))

const mockReturnRewards = vi.fn()
vi.mock("@/lib/loyalty", () => ({
  returnOrderRewards: (...a: unknown[]) => mockReturnRewards(...a),
}))

import { releaseDeliveryOrder } from "./release-delivery-order"

describe("releaseDeliveryOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReturnRewards.mockResolvedValue({ returned: 0 })
    mockPaymentsCancel.mockResolvedValue({})
    mockOrdersUpdate.mockResolvedValue({})
    // Search-time version is 1; after returning rewards / voiding, it's 5.
    mockOrdersGet.mockResolvedValue({
      order: { id: "O1", version: 5, fulfillments: [{ uid: "F1", state: "PROPOSED" }] },
    })
  })

  it("returns stars, voids the hold, then cancels with the re-fetched version", async () => {
    mockReturnRewards.mockResolvedValue({ returned: 9 })
    const res = await releaseDeliveryOrder({
      id: "O1",
      tenders: [{ id: "T1", cardDetails: { status: "AUTHORIZED" } }],
      rewards: [{ id: "R1" }],
    })

    expect(res).toEqual({ returned: 9, voided: true })
    expect(mockReturnRewards).toHaveBeenCalledWith(
      expect.objectContaining({ id: "O1", rewards: [{ id: "R1" }] }),
    )
    expect(mockPaymentsCancel).toHaveBeenCalledWith({ paymentId: "T1" })
    expect(mockOrdersGet).toHaveBeenCalledWith({ orderId: "O1" })
    // FRESH version (5), not whatever the caller had
    expect(mockOrdersUpdate.mock.calls[0][0].order.version).toBe(5)
    expect(mockOrdersUpdate.mock.calls[0][0].order.fulfillments).toEqual([
      { uid: "F1", state: "CANCELED" },
    ])
    // The ORDER must be canceled too, not just its fulfillment. Square does not
    // cascade fulfillment CANCELED → order CANCELED, and an OPEN order whose hold
    // is VOIDED (due > 0, no AUTHORIZED tender) is indistinguishable from an
    // abandoned cart to every customer-facing list (DE852, 2026-09-02).
    expect(mockOrdersUpdate.mock.calls[0][0].order.state).toBe("CANCELED")
  })

  it("does not void a $0 order with no tender", async () => {
    const res = await releaseDeliveryOrder({ id: "O2", rewards: [{ id: "R9" }] })
    expect(res.voided).toBe(false)
    expect(mockPaymentsCancel).not.toHaveBeenCalled()
    expect(mockReturnRewards).toHaveBeenCalled()
    expect(mockOrdersUpdate).toHaveBeenCalledTimes(1)
  })

  it("does not void when the hold is already VOIDED", async () => {
    const res = await releaseDeliveryOrder({
      id: "O3",
      tenders: [{ id: "T3", cardDetails: { status: "VOIDED" } }],
    })
    expect(res.voided).toBe(false)
    expect(mockPaymentsCancel).not.toHaveBeenCalled()
  })

  it("no-ops on an order with no id", async () => {
    const res = await releaseDeliveryOrder({})
    expect(res).toEqual({ returned: 0, voided: false })
    expect(mockReturnRewards).not.toHaveBeenCalled()
    expect(mockOrdersGet).not.toHaveBeenCalled()
  })
})
