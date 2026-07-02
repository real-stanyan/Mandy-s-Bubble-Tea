import { describe, it, expect, vi, beforeEach } from "vitest"

const mockOrdersGet = vi.fn()
const mockOrdersUpdate = vi.fn()
const mockOrdersPay = vi.fn()
const mockPaymentsComplete = vi.fn()
vi.mock("@/lib/square", () => ({
  squareClient: {
    orders: {
      get: (...a: unknown[]) => mockOrdersGet(...a),
      update: (...a: unknown[]) => mockOrdersUpdate(...a),
      pay: (...a: unknown[]) => mockOrdersPay(...a),
    },
    payments: {
      complete: (...a: unknown[]) => mockPaymentsComplete(...a),
    },
  },
  SQUARE_LOCATION_ID: "L1",
}))
const mockRecordDispatch = vi.fn()
const mockGetAccepted = vi.fn()
vi.mock("@/lib/driver-tokens", () => ({
  recordDispatch: (...a: unknown[]) => mockRecordDispatch(...a),
  getAcceptedOrderIds: (...a: unknown[]) => mockGetAccepted(...a),
}))
const mockConsumeDiscounts = vi.fn()
vi.mock("@/lib/consume-order-discounts", () => ({
  consumeOrderDiscounts: (...a: unknown[]) => mockConsumeDiscounts(...a),
}))
const mockRelease = vi.fn()
vi.mock("@/lib/release-delivery-order", () => ({
  releaseDeliveryOrder: (...a: unknown[]) => mockRelease(...a),
}))
const mockEnqueuePrint = vi.fn()
vi.mock("@/lib/print-jobs", () => ({
  enqueuePrintJob: (...a: unknown[]) => mockEnqueuePrint(...a),
}))
const mockEnqueueCupLabel = vi.fn()
vi.mock("@/lib/cup-label/enqueue", () => ({
  enqueueCupLabelJobs: (...a: unknown[]) => mockEnqueueCupLabel(...a),
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
    mockGetAccepted.mockResolvedValue(new Set())
    mockEnqueuePrint.mockResolvedValue({ queued: true, stickerNumber: "001" })
    mockEnqueueCupLabel.mockResolvedValue(undefined)
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

  it("captures the AUTHORIZED hold even when a FAILED tender precedes it (DE831 retry bug)", async () => {
    // Customer's first card declined (FAILED), retried successfully (AUTHORIZED).
    // Square keeps both tenders; accept must capture the live one, not bail on
    // the leading FAILED.
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "O1",
        version: 2,
        metadata: { fulfillment_type: "DELIVERY" },
        fulfillments: [{ uid: "F1", state: "PROPOSED" }],
        referenceId: "DE831",
        tenders: [
          { id: "PAY-FAILED", cardDetails: { status: "FAILED" } },
          { id: "PAY-OK", cardDetails: { status: "AUTHORIZED" } },
        ],
      },
    })
    mockPaymentsComplete.mockResolvedValue({})
    const res = await POST(req("driver-secret", { action: "accepted" }), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).captured).toBe(true)
    expect(mockPaymentsComplete).toHaveBeenCalledWith({ paymentId: "PAY-OK" })
    expect(mockRecordDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ status: "accepted" }),
    )
  })

  it("409s when every tender is dead (FAILED + VOIDED, no live hold)", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "O1",
        version: 2,
        metadata: { fulfillment_type: "DELIVERY" },
        fulfillments: [{ uid: "F1", state: "PROPOSED" }],
        referenceId: "DE832",
        tenders: [
          { id: "PAY-FAILED", cardDetails: { status: "FAILED" } },
          { id: "PAY-VOID", cardDetails: { status: "VOIDED" } },
        ],
      },
    })
    const res = await POST(req("driver-secret", { action: "accepted" }), { params })
    expect(res.status).toBe(409)
    expect(mockPaymentsComplete).not.toHaveBeenCalled()
    expect(mockRecordDispatch).not.toHaveBeenCalled()
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

  it("accepts a $0 order (no card tender) — runs deferred print + discount, no charge", async () => {
    mockOrdersGet.mockResolvedValue(orderWithTender(null))
    const res = await POST(req("driver-secret", { action: "accepted" }), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).captured).toBe(false)
    expect(mockPaymentsComplete).not.toHaveBeenCalled()
    // deferred-from-checkout side-effects run on the $0 accept
    expect(mockConsumeDiscounts).toHaveBeenCalled()
    expect(mockEnqueuePrint).toHaveBeenCalledWith(
      expect.objectContaining({ assumeSettled: true }),
    )
    expect(mockEnqueueCupLabel).toHaveBeenCalledWith(
      expect.objectContaining({ stickerNumber: "001" }),
    )
    expect(mockRecordDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ status: "accepted" }),
    )
  })

  it("re-accepting a $0 order is idempotent — no double print/consume", async () => {
    mockOrdersGet.mockResolvedValue(orderWithTender(null))
    mockGetAccepted.mockResolvedValue(new Set(["O1"])) // already accepted earlier
    const res = await POST(req("driver-secret", { action: "accepted" }), { params })
    expect(res.status).toBe(200)
    expect(mockConsumeDiscounts).not.toHaveBeenCalled()
    expect(mockEnqueuePrint).not.toHaveBeenCalled()
    // still records the (idempotent) acceptance
    expect(mockRecordDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ status: "accepted" }),
    )
  })
})

describe("POST /api/driver/orders/[orderId]/status — delivered (settle)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STAFF_DELIVERY_TOKEN = "driver-secret"
    process.env.ADMIN_DELIVERY_TOKEN = "admin-secret"
    mockConsumeDiscounts.mockResolvedValue(undefined)
  })

  const zeroOrder = (state: string = "OPEN") => ({
    order: {
      id: "O1",
      version: 3,
      state,
      metadata: { fulfillment_type: "DELIVERY" },
      fulfillments: [{ uid: "F1", state: "PREPARED" }],
      referenceId: "DE837",
      totalMoney: { amount: 0n, currency: "AUD" },
      tenders: [],
    },
  })

  const paidOrder = (tenderStatus: string) => ({
    order: {
      id: "O1",
      version: 3,
      state: "OPEN",
      metadata: { fulfillment_type: "DELIVERY" },
      fulfillments: [{ uid: "F1", state: "PREPARED" }],
      referenceId: "DE836",
      totalMoney: { amount: 1250n, currency: "AUD" },
      tenders: [{ id: "PAY1", cardDetails: { status: tenderStatus } }],
    },
  })

  it("settles a $0 no-tender order via orders.pay (empty paymentIds) and skips the fulfillment update", async () => {
    // DE837 bug: a $0 loyalty-comped delivery order has no tender and was never
    // settled at checkout (DE833 deferral). Square refuses to COMPLETE a
    // fulfillment on an unpaid order, so 'delivered' must settle via orders.pay
    // — which completes both the order and its fulfillment in one call.
    mockOrdersGet.mockResolvedValue(zeroOrder())
    mockOrdersPay.mockResolvedValue({ order: { id: "O1", state: "COMPLETED" } })
    const res = await POST(req("driver-secret", { action: "delivered" }), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.fulfillmentState).toBe("COMPLETED")
    expect(mockOrdersPay).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "O1", paymentIds: [] }),
    )
    // orders.pay already completed the fulfillment — a follow-up orders.update
    // would hit a version conflict / error on the closed order.
    expect(mockOrdersUpdate).not.toHaveBeenCalled()
    // no card to capture
    expect(mockPaymentsComplete).not.toHaveBeenCalled()
    expect(mockRecordDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ status: "delivered" }),
    )
  })

  it("re-tapping delivered on an already-COMPLETED $0 order is a no-op success (no second orders.pay)", async () => {
    mockOrdersGet.mockResolvedValue(zeroOrder("COMPLETED"))
    const res = await POST(req("driver-secret", { action: "delivered" }), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(mockOrdersPay).not.toHaveBeenCalled()
    expect(mockOrdersUpdate).not.toHaveBeenCalled()
  })

  it("paid (CAPTURED) order keeps the original path: fulfillment update, no orders.pay", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder("CAPTURED"))
    mockOrdersUpdate.mockResolvedValue({})
    const res = await POST(req("driver-secret", { action: "delivered" }), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).fulfillmentState).toBe("COMPLETED")
    expect(mockOrdersPay).not.toHaveBeenCalled()
    expect(mockPaymentsComplete).not.toHaveBeenCalled()
    expect(mockOrdersUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "O1",
        order: expect.objectContaining({
          fulfillments: [{ uid: "F1", state: "COMPLETED" }],
        }),
      }),
    )
    expect(mockRecordDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ status: "delivered" }),
    )
  })

  it("paid order still only AUTHORIZED at delivery: captures then updates fulfillment (existing safety net)", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder("AUTHORIZED"))
    mockPaymentsComplete.mockResolvedValue({})
    mockOrdersUpdate.mockResolvedValue({})
    const res = await POST(req("driver-secret", { action: "delivered" }), { params })
    expect(res.status).toBe(200)
    expect(mockPaymentsComplete).toHaveBeenCalledWith({ paymentId: "PAY1" })
    expect(mockOrdersPay).not.toHaveBeenCalled()
    expect(mockOrdersUpdate).toHaveBeenCalled()
  })
})

describe("POST /api/driver/orders/[orderId]/status — reject (decline)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STAFF_DELIVERY_TOKEN = "driver-secret"
    process.env.ADMIN_DELIVERY_TOKEN = "admin-secret"
    mockRelease.mockResolvedValue({ returned: 9, voided: true })
  })

  const orderWithTender = (tenderStatus: string | null) => ({
    order: {
      id: "O1",
      version: 2,
      metadata: { fulfillment_type: "DELIVERY" },
      fulfillments: [{ uid: "F1", state: "PROPOSED" }],
      referenceId: "DE826",
      tenders: tenderStatus
        ? [{ id: "PAY1", cardDetails: { status: tenderStatus } }]
        : [],
    },
  })

  it("releases an AUTHORIZED order (void + return stars + cancel)", async () => {
    mockOrdersGet.mockResolvedValue(orderWithTender("AUTHORIZED"))
    const res = await POST(req("driver-secret", { action: "rejected" }), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, released: true, returned: 9, voided: true })
    expect(mockRelease).toHaveBeenCalledWith(expect.objectContaining({ id: "O1" }))
    // declining is not a dispatch milestone
    expect(mockRecordDispatch).not.toHaveBeenCalled()
  })

  it("releases a $0 free-redeem order (no tender)", async () => {
    mockRelease.mockResolvedValue({ returned: 9, voided: false })
    mockOrdersGet.mockResolvedValue(orderWithTender(null))
    const res = await POST(req("driver-secret", { action: "rejected" }), { params })
    expect(res.status).toBe(200)
    expect((await res.json())).toMatchObject({ released: true, voided: false })
    expect(mockRelease).toHaveBeenCalled()
  })

  it("409s declining an already-CAPTURED (accepted) order — must refund instead", async () => {
    mockOrdersGet.mockResolvedValue(orderWithTender("CAPTURED"))
    const res = await POST(req("driver-secret", { action: "rejected" }), { params })
    expect(res.status).toBe(409)
    expect(mockRelease).not.toHaveBeenCalled()
  })

  it("admin (read-only) cannot decline", async () => {
    const res = await POST(req("admin-secret", { action: "rejected" }), { params })
    expect(res.status).toBe(403)
    expect(mockRelease).not.toHaveBeenCalled()
  })
})
