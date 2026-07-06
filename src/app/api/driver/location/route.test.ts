import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUpdateLocation = vi.fn()
vi.mock("@/lib/driver-tokens", () => ({
  updateDriverLocation: (...a: unknown[]) => mockUpdateLocation(...a),
}))
const mockSendLiveActivityGpsPush = vi.fn()
vi.mock("@/lib/live-activity", () => ({
  sendLiveActivityGpsPush: (...a: unknown[]) => mockSendLiveActivityGpsPush(...a),
}))
// The Live Activity GPS forward registers through after() (fire-and-forget
// past the response). Run the callback inline so tests can assert on it.
const mockAfter = vi.fn((cb: () => unknown) => {
  void cb()
})
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (cb: () => unknown) => mockAfter(cb),
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
    expect(mockSendLiveActivityGpsPush).not.toHaveBeenCalled()
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
    // fix forwarded to the customer's Live Activity via after()
    expect(mockSendLiveActivityGpsPush).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "O1", lat: -27.9, lng: 153.4 }),
    )
  })

  it("does not forward to the Live Activity when the fix write fails", async () => {
    mockUpdateLocation.mockRejectedValue(new Error("db down"))
    const res = await POST(req("driver-secret", { orderId: "O1", lat: -27.9, lng: 153.4 }))
    expect(res.status).toBe(502)
    expect(mockSendLiveActivityGpsPush).not.toHaveBeenCalled()
  })
})
