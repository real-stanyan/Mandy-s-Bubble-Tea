import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGetAuthedUser = vi.fn()
vi.mock("@/lib/auth", () => ({
  getAuthedUser: (...a: unknown[]) => mockGetAuthedUser(...a),
}))

const mockOrdersGet = vi.fn()
vi.mock("@/lib/square", () => ({
  squareClient: { orders: { get: (...a: unknown[]) => mockOrdersGet(...a) } },
}))

const mockUpsertToken = vi.fn()
vi.mock("@/lib/live-activity", () => ({
  upsertLiveActivityToken: (...a: unknown[]) => mockUpsertToken(...a),
}))

import { POST } from "./route"

const ORDER_ID = "ORDER1"
const VALID_TOKEN = "ab01".repeat(40) // 160-char hex, typical ActivityKit token

function req(body: unknown): Request {
  return new Request(`http://localhost/api/orders/${ORDER_ID}/live-activity-token`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

function post(body: unknown) {
  return POST(req(body), { params: Promise.resolve({ orderId: ORDER_ID }) })
}

const owner = {
  userId: "user-1",
  email: null,
  phone: null,
  profile: { square_customer_id: "CUST1" },
}

describe("POST /api/orders/[orderId]/live-activity-token", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("401s without an authenticated user", async () => {
    mockGetAuthedUser.mockResolvedValue(null)
    const res = await post({ activityToken: VALID_TOKEN })
    expect(res.status).toBe(401)
    expect(mockUpsertToken).not.toHaveBeenCalled()
  })

  it("400s on invalid JSON", async () => {
    mockGetAuthedUser.mockResolvedValue(owner)
    const res = await post("{not json")
    expect(res.status).toBe(400)
    expect(mockUpsertToken).not.toHaveBeenCalled()
  })

  it("400s on a non-hex activityToken", async () => {
    mockGetAuthedUser.mockResolvedValue(owner)
    const res = await post({ activityToken: "definitely not hex!" })
    expect(res.status).toBe(400)
    expect(mockOrdersGet).not.toHaveBeenCalled()
    expect(mockUpsertToken).not.toHaveBeenCalled()
  })

  it("403s when the authed user does not own the order", async () => {
    mockGetAuthedUser.mockResolvedValue(owner)
    mockOrdersGet.mockResolvedValue({ order: { customerId: "SOMEONE_ELSE" } })
    const res = await post({ activityToken: VALID_TOKEN })
    expect(res.status).toBe(403)
    expect(mockUpsertToken).not.toHaveBeenCalled()
  })

  it("403s when the user has no linked Square customer", async () => {
    mockGetAuthedUser.mockResolvedValue({ ...owner, profile: null })
    mockOrdersGet.mockResolvedValue({ order: { customerId: "CUST1" } })
    const res = await post({ activityToken: VALID_TOKEN })
    expect(res.status).toBe(403)
    expect(mockUpsertToken).not.toHaveBeenCalled()
  })

  it("404s when the Square order lookup fails", async () => {
    mockGetAuthedUser.mockResolvedValue(owner)
    mockOrdersGet.mockRejectedValue(new Error("order not found"))
    const res = await post({ activityToken: VALID_TOKEN })
    expect(res.status).toBe(404)
    expect(mockUpsertToken).not.toHaveBeenCalled()
  })

  it("stores the token for the authenticated order owner", async () => {
    mockGetAuthedUser.mockResolvedValue(owner)
    mockOrdersGet.mockResolvedValue({ order: { customerId: "CUST1" } })
    mockUpsertToken.mockResolvedValue(undefined)
    const res = await post({ activityToken: VALID_TOKEN })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(mockUpsertToken).toHaveBeenCalledWith(ORDER_ID, VALID_TOKEN)
  })

  it("500s when the store write fails", async () => {
    mockGetAuthedUser.mockResolvedValue(owner)
    mockOrdersGet.mockResolvedValue({ order: { customerId: "CUST1" } })
    mockUpsertToken.mockRejectedValue(new Error("db down"))
    const res = await post({ activityToken: VALID_TOKEN })
    expect(res.status).toBe(500)
  })
})
