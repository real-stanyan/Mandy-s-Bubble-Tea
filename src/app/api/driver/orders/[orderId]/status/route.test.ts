import { describe, it, expect, vi, beforeEach } from "vitest"

const mockOrdersGet = vi.fn()
const mockOrdersUpdate = vi.fn()
const mockPaymentsComplete = vi.fn()
vi.mock("@/lib/square", () => ({
  squareClient: {
    orders: {
      get: (...a: unknown[]) => mockOrdersGet(...a),
      update: (...a: unknown[]) => mockOrdersUpdate(...a),
    },
    payments: {
      complete: (...a: unknown[]) => mockPaymentsComplete(...a),
    },
  },
  SQUARE_LOCATION_ID: "L1",
}))
const mockRecordDispatch = vi.fn()
vi.mock("@/lib/driver-tokens", () => ({
  recordDispatch: (...a: unknown[]) => mockRecordDispatch(...a),
}))
const mockConsumeDiscounts = vi.fn()
vi.mock("@/lib/consume-order-discounts", () => ({
  consumeOrderDiscounts: (...a: unknown[]) => mockConsumeDiscounts(...a),
}))

import { POST } from "./route"

function req(bearer: string, body: unknown): Request {
  return new Request("http://localhost/api/driver/orders/O1/status", {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  })
}
const params = Promise.resolve({ orderId: "O1" })

describe("POST /api/driver/orders/[orderId]/status — admin guard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STAFF_DELIVERY_TOKEN = "driver-secret"
    process.env.ADMIN_DELIVERY_TOKEN = "admin-secret"
  })

  it("403s the admin token without touching Square", async () => {
    const res = await POST(req("admin-secret", { action: "picked_up" }), { params })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(mockOrdersGet).not.toHaveBeenCalled()
    expect(mockRecordDispatch).not.toHaveBeenCalled()
  })

  it("still 401s a wrong token", async () => {
    const res = await POST(req("nope", { action: "picked_up" }), { params })
    expect(res.status).toBe(401)
  })

  it("lets the driver token through to the Square path", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        version: 1,
        metadata: { fulfillment_type: "DELIVERY" },
        fulfillments: [{ uid: "F1" }],
        referenceId: "DE801",
      },
    })
    mockOrdersUpdate.mockResolvedValue({})
    const res = await POST(req("driver-secret", { action: "picked_up" }), { params })
    expect(res.status).toBe(200)
    expect(mockRecordDispatch).toHaveBeenCalled()
  })
})

describe("POST /api/driver/orders/[orderId]/status — accept (capture)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STAFF_DELIVERY_TOKEN = "driver-secret"
    process.env.ADMIN_DELIVERY_TOKEN = "admin-secret"
    mockConsumeDiscounts.mockResolvedValue(undefined)
  })

  const orderWithTender = (tenderStatus: string | null) => ({
    order: {
      id: "O1",
      version: 2,
      metadata: { fulfillment_type: "DELIVERY" },
      fulfillments: [{ uid: "F1", state: "PROPOSED" }],
      referenceId: "DE821",
      tenders: tenderStatus
        ? [{ id: "PAY1", cardDetails: { status: tenderStatus } }]
        : [],
    },
  })

  it("captures an AUTHORIZED hold, consumes discounts, records accepted — no fulfillment change", async () => {
    mockOrdersGet.mockResolvedValue(orderWithTender("AUTHORIZED"))
    mockPaymentsComplete.mockResolvedValue({})
    const res = await POST(req("driver-secret", { action: "accepted" }), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).captured).toBe(true)
    expect(mockPaymentsComplete).toHaveBeenCalledWith({ paymentId: "PAY1" })
    expect(mockConsumeDiscounts).toHaveBeenCalled()
    expect(mockRecordDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ status: "accepted" }),
    )
    // fulfillment state must NOT move on accept
    expect(mockOrdersUpdate).not.toHaveBeenCalled()
  })

  it("is idempotent when already CAPTURED — no second charge", async () => {
    mockOrdersGet.mockResolvedValue(orderWithTender("CAPTURED"))
    const res = await POST(req("driver-secret", { action: "accepted" }), { params })
    expect(res.status).toBe(200)
    expect(mockPaymentsComplete).not.toHaveBeenCalled()
    expect(mockRecordDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ status: "accepted" }),
    )
  })

  it("409s a VOIDED (timed-out) authorization without charging", async () => {
    mockOrdersGet.mockResolvedValue(orderWithTender("VOIDED"))
    const res = await POST(req("driver-secret", { action: "accepted" }), { params })
    expect(res.status).toBe(409)
    expect(mockPaymentsComplete).not.toHaveBeenCalled()
    expect(mockRecordDispatch).not.toHaveBeenCalled()
  })

  it("accepts a $0 order (no card tender) — records accepted, no charge", async () => {
    mockOrdersGet.mockResolvedValue(orderWithTender(null))
    const res = await POST(req("driver-secret", { action: "accepted" }), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).captured).toBe(false)
    expect(mockPaymentsComplete).not.toHaveBeenCalled()
    expect(mockRecordDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ status: "accepted" }),
    )
  })
})
