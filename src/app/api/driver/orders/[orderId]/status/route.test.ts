import { describe, it, expect, vi, beforeEach } from "vitest"

const mockOrdersGet = vi.fn()
const mockOrdersUpdate = vi.fn()
vi.mock("@/lib/square", () => ({
  squareClient: {
    orders: {
      get: (...a: unknown[]) => mockOrdersGet(...a),
      update: (...a: unknown[]) => mockOrdersUpdate(...a),
    },
  },
  SQUARE_LOCATION_ID: "L1",
}))
const mockRecordDispatch = vi.fn()
vi.mock("@/lib/driver-tokens", () => ({
  recordDispatch: (...a: unknown[]) => mockRecordDispatch(...a),
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
