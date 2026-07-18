import { describe, it, expect, vi, beforeEach } from "vitest"

const mockSearch = vi.fn()
vi.mock("@/lib/square", () => ({
  squareClient: { orders: { search: (...a: unknown[]) => mockSearch(...a) } },
  SQUARE_LOCATION_ID: "L1",
}))
const mockGetFixes = vi.fn<(...a: unknown[]) => unknown>()
const mockGetAccepted = vi.fn<(...a: unknown[]) => Promise<Set<string>>>(async () => new Set<string>())
vi.mock("@/lib/driver-tokens", () => ({
  getDriverFixesForOrders: (...a: unknown[]) => mockGetFixes(...a),
  getAcceptedOrderIds: (...a: unknown[]) => mockGetAccepted(...a),
}))

import { GET } from "./route"

function req(bearer: string): Request {
  return new Request("http://localhost/api/driver/orders", {
    headers: { authorization: `Bearer ${bearer}` },
  })
}

// A paid, active self-delivery order as Square returns it.
const sqOrder = {
  id: "O1",
  referenceId: "DE801",
  createdAt: "2026-06-04T00:00:00Z",
  metadata: {
    fulfillment_type: "DELIVERY",
    delivery_address: "1 Test St",
    delivery_lat: "-27.9",
    delivery_lng: "153.4",
  },
  totalMoney: { amount: 1000n },
  netAmountDueMoney: { amount: 0n },
  fulfillments: [
    {
      uid: "F1",
      state: "PREPARED",
      pickupDetails: { recipient: { phoneNumber: "+61400000000" }, note: "leave at door" },
    },
  ],
  lineItems: [{ quantity: "1", name: "Milk Tea" }],
}

describe("GET /api/driver/orders — roles", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STAFF_DELIVERY_TOKEN = "driver-secret"
    process.env.ADMIN_DELIVERY_TOKEN = "admin-secret"
    mockSearch.mockResolvedValue({ orders: [sqOrder] })
  })

  it("returns role=driver with no driver GPS and no dispatch query", async () => {
    const res = await GET(req("driver-secret"))
    const json = await res.json()
    expect(json.role).toBe("driver")
    expect(json.orders[0].driver).toBeUndefined()
    expect(mockGetFixes).not.toHaveBeenCalled()
  })

  it("returns role=admin with the driver fix attached", async () => {
    mockGetFixes.mockResolvedValue({
      O1: { lat: -27.91, lng: 153.41, heading: 45, updatedAt: "2026-06-04T01:00:00Z" },
    })
    const res = await GET(req("admin-secret"))
    const json = await res.json()
    expect(json.role).toBe("admin")
    expect(json.orders[0].driver).toEqual({
      lat: -27.91,
      lng: 153.41,
      heading: 45,
      updatedAt: "2026-06-04T01:00:00Z",
    })
    expect(mockGetFixes).toHaveBeenCalledWith(["O1"])
  })

  it("attaches driver:null for an admin order with no fix yet", async () => {
    mockGetFixes.mockResolvedValue({})
    const res = await GET(req("admin-secret"))
    const json = await res.json()
    expect(json.orders[0].driver).toBeNull()
  })
})

describe("GET /api/driver/orders — deliveryFeeCents", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STAFF_DELIVERY_TOKEN = "driver-secret"
    process.env.ADMIN_DELIVERY_TOKEN = "admin-secret"
  })

  it("extracts the delivery-fee service charge as cents", async () => {
    mockSearch.mockResolvedValue({
      orders: [
        {
          ...sqOrder,
          serviceCharges: [
            { uid: "service-fee", amountMoney: { amount: 250n } },
            { uid: "delivery-fee", amountMoney: { amount: 499n } },
          ],
        },
      ],
    })
    const res = await GET(req("driver-secret"))
    const json = await res.json()
    expect(json.orders[0].deliveryFeeCents).toBe("499")
  })

  it('returns "0" when the order has no delivery-fee charge (free delivery)', async () => {
    mockSearch.mockResolvedValue({ orders: [sqOrder] })
    const res = await GET(req("driver-secret"))
    const json = await res.json()
    expect(json.orders[0].deliveryFeeCents).toBe("0")
  })
})
