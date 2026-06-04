import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUpdateLocation = vi.fn()
vi.mock("@/lib/driver-tokens", () => ({
  updateDriverLocation: (...a: unknown[]) => mockUpdateLocation(...a),
}))

import { POST } from "./route"

function req(bearer: string, body: unknown): Request {
  return new Request("http://localhost/api/driver/location", {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  })
}

describe("POST /api/driver/location — admin guard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STAFF_DELIVERY_TOKEN = "driver-secret"
    process.env.ADMIN_DELIVERY_TOKEN = "admin-secret"
  })

  it("403s the admin token without writing a fix", async () => {
    const res = await POST(req("admin-secret", { orderId: "O1", lat: -27.9, lng: 153.4 }))
    expect(res.status).toBe(403)
    expect(mockUpdateLocation).not.toHaveBeenCalled()
  })

  it("accepts a driver fix", async () => {
    mockUpdateLocation.mockResolvedValue(undefined)
    const res = await POST(req("driver-secret", { orderId: "O1", lat: -27.9, lng: 153.4 }))
    expect(res.status).toBe(200)
    expect(mockUpdateLocation).toHaveBeenCalledWith({
      orderId: "O1",
      lat: -27.9,
      lng: 153.4,
      heading: null,
    })
  })
})
