import { describe, it, expect, vi, beforeEach } from "vitest"

const mockOrdersSearch = vi.fn()
vi.mock("@/lib/square", () => ({
  squareClient: {
    orders: { search: (...a: unknown[]) => mockOrdersSearch(...a) },
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

// The release sequence (return stars → void → re-fetch → cancel) is unit-tested
// in release-delivery-order.test.ts; here we assert the sweep calls it for the
// right candidates and skips the rest.
const mockRelease = vi.fn()
vi.mock("@/lib/release-delivery-order", () => ({
  releaseDeliveryOrder: (...a: unknown[]) => mockRelease(...a),
}))

const mockNag = vi.fn()
vi.mock("@/lib/driver-notify", () => ({
  nagDriversUnacceptedDelivery: (...a: unknown[]) => mockNag(...a),
}))

import { GET } from "./route"

function req(): Request {
  return new Request("http://localhost/api/cron/delivery-auth-timeout", {
    headers: { authorization: "Bearer cron-secret" },
  })
}

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

describe("GET /api/cron/delivery-auth-timeout", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "cron-secret"
    mockBearer.mockReturnValue(true)
    mockGetAccepted.mockResolvedValue(new Set())
    mockRelease.mockResolvedValue({ returned: 1, voided: true })
  })

  it("401s a bad cron token without scanning", async () => {
    mockBearer.mockReturnValue(false)
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(mockOrdersSearch).not.toHaveBeenCalled()
  })

  it("releases an unaccepted, still-held delivery order", async () => {
    mockOrdersSearch.mockResolvedValue({
      orders: [authedOrderWithReward()],
      cursor: undefined,
    })

    const res = await GET(req())
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, scanned: 1, cancelled: 1 })
    expect(mockRelease).toHaveBeenCalledWith(
      expect.objectContaining({ id: "O1" }),
    )
  })

  it("nags — not releases — an order still inside the 30-minute grace", async () => {
    // 10 minutes old: past the 5-minute nag threshold, well before cancel.
    // The Jorja case (2026-08-09): one missed popup, then silence, then an
    // auto-cancel nobody understood. Every sweep tick must shout again.
    const order = {
      ...authedOrderWithReward(),
      createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    }
    mockOrdersSearch.mockResolvedValue({ orders: [order], cursor: undefined })
    mockNag.mockResolvedValue(undefined)

    const res = await GET(req())
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, cancelled: 0, nagged: 1 })
    expect(mockRelease).not.toHaveBeenCalled()
    // age 10 min, 20 min left before auto-cancel.
    expect(mockNag).toHaveBeenCalledWith(
      expect.objectContaining({ id: "O1" }),
      10,
      20,
    )
  })

  it("does not nag an order a driver already accepted", async () => {
    const order = {
      ...authedOrderWithReward(),
      createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    }
    mockOrdersSearch.mockResolvedValue({ orders: [order], cursor: undefined })
    mockGetAccepted.mockResolvedValue(new Set(["O1"]))

    const res = await GET(req())
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, nagged: 0, cancelled: 0 })
    expect(mockNag).not.toHaveBeenCalled()
  })

  it("a nag failure is logged, not fatal to the sweep", async () => {
    const young = {
      ...authedOrderWithReward(),
      createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    }
    const old = { ...authedOrderWithReward(), id: "O2", referenceId: "DE827" }
    mockOrdersSearch.mockResolvedValue({ orders: [young, old], cursor: undefined })
    mockNag.mockRejectedValue(new Error("expo down"))

    const res = await GET(req())
    const json = await res.json()
    // The old order still gets released even though the nag threw.
    expect(json).toMatchObject({ ok: true, cancelled: 1, nagged: 0 })
    expect(json.errors.join()).toContain("expo down")
    expect(mockRelease).toHaveBeenCalledWith(expect.objectContaining({ id: "O2" }))
  })

  it("releases a $0 free-redeem order (no tender) too", async () => {
    mockRelease.mockResolvedValue({ returned: 1, voided: false })
    mockOrdersSearch.mockResolvedValue({
      orders: [
        {
          id: "O2",
          version: 1,
          metadata: { fulfillment_type: "DELIVERY" },
          fulfillments: [{ uid: "F2", state: "PROPOSED" }],
          rewards: [{ id: "R9" }],
        },
      ],
      cursor: undefined,
    })

    const res = await GET(req())
    expect((await res.json())).toMatchObject({ ok: true, cancelled: 1 })
    expect(mockRelease).toHaveBeenCalledWith(expect.objectContaining({ id: "O2" }))
  })

  it("skips an order a driver already accepted", async () => {
    mockGetAccepted.mockResolvedValue(new Set(["O1"]))
    mockOrdersSearch.mockResolvedValue({
      orders: [authedOrderWithReward()],
      cursor: undefined,
    })

    const res = await GET(req())
    expect((await res.json())).toMatchObject({ scanned: 0, cancelled: 0 })
    expect(mockRelease).not.toHaveBeenCalled()
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
        },
      ],
      cursor: undefined,
    })

    const res = await GET(req())
    expect((await res.json())).toMatchObject({ scanned: 0, cancelled: 0 })
    expect(mockRelease).not.toHaveBeenCalled()
  })
})
