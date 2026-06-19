import { describe, it, expect, vi, beforeEach } from "vitest"

const mockOrdersSearch = vi.fn()
const mockOrdersGet = vi.fn()
const mockOrdersUpdate = vi.fn()
const mockPaymentsCancel = vi.fn()
vi.mock("@/lib/square", () => ({
  squareClient: {
    orders: {
      search: (...a: unknown[]) => mockOrdersSearch(...a),
      get: (...a: unknown[]) => mockOrdersGet(...a),
      update: (...a: unknown[]) => mockOrdersUpdate(...a),
    },
    payments: { cancel: (...a: unknown[]) => mockPaymentsCancel(...a) },
  },
  SQUARE_LOCATION_ID: "L1",
}))

const mockBearer = vi.fn()
vi.mock("@/lib/bearer-auth", () => ({
  bearerTokenMatches: (...a: unknown[]) => mockBearer(...a),
}))

const mockGetAccepted = vi.fn()
vi.mock("@/lib/driver-tokens", () => ({
  getAcceptedOrderIds: (...a: unknown[]) => mockGetAccepted(...a),
}))

const mockReturnRewards = vi.fn()
vi.mock("@/lib/loyalty", () => ({
  returnOrderRewards: (...a: unknown[]) => mockReturnRewards(...a),
}))

import { GET } from "./route"

function req(): Request {
  return new Request("http://localhost/api/cron/delivery-auth-timeout", {
    headers: { authorization: "Bearer cron-secret" },
  })
}

// A timed-out, unaccepted, paid (AUTHORIZED hold) delivery order that redeemed
// a star. Search returns version 1; the re-fetch returns the post-return
// version 5 — the cancel must use 5, not 1.
function authedOrderWithReward() {
  return {
    id: "O1",
    referenceId: "DE826",
    version: 1,
    metadata: { fulfillment_type: "DELIVERY" },
    fulfillments: [{ uid: "F1", state: "PROPOSED" }],
    tenders: [{ id: "T1", cardDetails: { status: "AUTHORIZED" } }],
    rewards: [{ id: "R1" }],
  }
}

describe("GET /api/cron/delivery-auth-timeout — star return on auto-cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "cron-secret"
    mockBearer.mockReturnValue(true)
    mockGetAccepted.mockResolvedValue(new Set())
    mockReturnRewards.mockResolvedValue({ returned: 1 })
    mockPaymentsCancel.mockResolvedValue({})
    mockOrdersUpdate.mockResolvedValue({})
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "O1",
        version: 5,
        fulfillments: [{ uid: "F1", state: "PROPOSED" }],
      },
    })
  })

  it("401s a bad cron token without scanning", async () => {
    mockBearer.mockReturnValue(false)
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(mockOrdersSearch).not.toHaveBeenCalled()
  })

  it("returns stars, voids the hold, then cancels with the re-fetched version", async () => {
    mockOrdersSearch.mockResolvedValue({
      orders: [authedOrderWithReward()],
      cursor: undefined,
    })

    const res = await GET(req())
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, scanned: 1, cancelled: 1 })

    // stars returned for this exact order
    expect(mockReturnRewards).toHaveBeenCalledWith(
      expect.objectContaining({ id: "O1", rewards: [{ id: "R1" }] }),
    )
    // held authorization voided
    expect(mockPaymentsCancel).toHaveBeenCalledWith({ paymentId: "T1" })
    // re-fetched before cancelling
    expect(mockOrdersGet).toHaveBeenCalledWith({ orderId: "O1" })
    // cancelled with the FRESH version (5), not the stale search version (1)
    expect(mockOrdersUpdate).toHaveBeenCalledTimes(1)
    expect(mockOrdersUpdate.mock.calls[0][0].order.version).toBe(5)
    expect(mockOrdersUpdate.mock.calls[0][0].order.fulfillments).toEqual([
      { uid: "F1", state: "CANCELED" },
    ])
  })

  it("returns stars and cancels a $0 free-redeem order without voiding (no tender)", async () => {
    mockOrdersSearch.mockResolvedValue({
      orders: [
        {
          id: "O2",
          referenceId: "DE827",
          version: 1,
          metadata: { fulfillment_type: "DELIVERY" },
          fulfillments: [{ uid: "F2", state: "PROPOSED" }],
          // no tenders → $0 loyalty order
          rewards: [{ id: "R9" }],
        },
      ],
      cursor: undefined,
    })
    mockOrdersGet.mockResolvedValue({
      order: { id: "O2", version: 3, fulfillments: [{ uid: "F2", state: "PROPOSED" }] },
    })

    const res = await GET(req())
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, scanned: 1, cancelled: 1 })
    expect(mockReturnRewards).toHaveBeenCalledWith(
      expect.objectContaining({ id: "O2" }),
    )
    expect(mockPaymentsCancel).not.toHaveBeenCalled() // nothing to void
    expect(mockOrdersUpdate.mock.calls[0][0].order.version).toBe(3)
  })

  it("skips an order a driver already accepted — no star return, no cancel", async () => {
    mockGetAccepted.mockResolvedValue(new Set(["O1"]))
    mockOrdersSearch.mockResolvedValue({
      orders: [authedOrderWithReward()],
      cursor: undefined,
    })

    const res = await GET(req())
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, scanned: 0, cancelled: 0 })
    expect(mockReturnRewards).not.toHaveBeenCalled()
    expect(mockPaymentsCancel).not.toHaveBeenCalled()
    expect(mockOrdersUpdate).not.toHaveBeenCalled()
  })

  it("skips a CAPTURED order (already accepted/charged)", async () => {
    mockOrdersSearch.mockResolvedValue({
      orders: [
        {
          id: "O3",
          version: 1,
          metadata: { fulfillment_type: "DELIVERY" },
          fulfillments: [{ uid: "F3", state: "PROPOSED" }],
          tenders: [{ id: "T3", cardDetails: { status: "CAPTURED" } }],
          rewards: [{ id: "R3" }],
        },
      ],
      cursor: undefined,
    })

    const res = await GET(req())
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, scanned: 0, cancelled: 0 })
    expect(mockReturnRewards).not.toHaveBeenCalled()
    expect(mockOrdersUpdate).not.toHaveBeenCalled()
  })
})
