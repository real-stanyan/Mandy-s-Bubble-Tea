import { describe, it, expect, vi, beforeEach } from "vitest"

// DE888 (2026-09-06): a delivery cart abandoned at the Apple Pay sheet (no
// tender, due > 0) was mistaken for a "$0 loyalty order" — nagged to every
// driver for 25 minutes, then CANCELED, which poisoned the customer's
// idempotent retry. A never-paid checkout is nobody's business: no nag, no
// release.

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

const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString()

function unpaidCart(createdAt: string, tenders: unknown[] = []) {
  return {
    id: "DE888",
    referenceId: "DE888",
    version: 2,
    createdAt,
    metadata: { fulfillment_type: "DELIVERY" },
    fulfillments: [{ uid: "F1", state: "PROPOSED" }],
    totalMoney: { amount: 2573n },
    netAmountDueMoney: { amount: 2573n },
    tenders,
    rewards: [],
  }
}

describe("GET /api/cron/delivery-auth-timeout — never-paid carts are left alone", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "cron-secret"
    mockBearer.mockReturnValue(true)
    mockGetAccepted.mockResolvedValue(new Set())
    mockRelease.mockResolvedValue({ returned: 0, voided: false })
    mockNag.mockResolvedValue(undefined)
  })

  it("does not nag drivers about an abandoned cart inside the grace window", async () => {
    mockOrdersSearch.mockResolvedValue({ orders: [unpaidCart(minutesAgo(10))], cursor: undefined })
    const json = await (await GET(req())).json()
    expect(json).toMatchObject({ ok: true, nagged: 0, cancelled: 0, scanned: 0 })
    expect(mockNag).not.toHaveBeenCalled()
  })

  it("does not cancel an abandoned cart past the 30-minute threshold", async () => {
    mockOrdersSearch.mockResolvedValue({ orders: [unpaidCart(minutesAgo(31))], cursor: undefined })
    const json = await (await GET(req())).json()
    expect(json).toMatchObject({ ok: true, nagged: 0, cancelled: 0, scanned: 0 })
    expect(mockRelease).not.toHaveBeenCalled()
  })

  it("an every-attempt-declined cart (FAILED tender only) is unpaid too", async () => {
    mockOrdersSearch.mockResolvedValue({
      orders: [unpaidCart(minutesAgo(31), [{ id: "T1", cardDetails: { status: "FAILED" } }])],
      cursor: undefined,
    })
    const json = await (await GET(req())).json()
    expect(json).toMatchObject({ cancelled: 0, nagged: 0 })
    expect(mockRelease).not.toHaveBeenCalled()
  })

  it("still releases a real held order past 30 minutes", async () => {
    mockRelease.mockResolvedValue({ returned: 0, voided: true })
    mockOrdersSearch.mockResolvedValue({
      orders: [unpaidCart(minutesAgo(31), [{ id: "T1", cardDetails: { status: "AUTHORIZED" } }])],
      cursor: undefined,
    })
    const json = await (await GET(req())).json()
    expect(json).toMatchObject({ cancelled: 1 })
    expect(mockRelease).toHaveBeenCalledWith(expect.objectContaining({ id: "DE888" }))
  })

  it("still nags about a real held order inside the window", async () => {
    mockOrdersSearch.mockResolvedValue({
      orders: [unpaidCart(minutesAgo(10), [{ id: "T1", cardDetails: { status: "AUTHORIZED" } }])],
      cursor: undefined,
    })
    const json = await (await GET(req())).json()
    expect(json).toMatchObject({ nagged: 1 })
    expect(mockNag).toHaveBeenCalledWith(expect.objectContaining({ id: "DE888" }), 10, 20)
  })
})
