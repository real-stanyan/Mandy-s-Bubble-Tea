import { describe, it, expect, vi, beforeEach } from "vitest"

const mockVerifyAuth = vi.fn()
const mockGetPassBySerial = vi.fn()
const mockFetchCustomerPassData = vi.fn()
const mockBuildPass = vi.fn()

vi.mock("@/lib/wallet/auth", () => ({
  verifyApplePassAuth: (...a: unknown[]) => mockVerifyAuth(...a),
}))
vi.mock("@/lib/wallet/db", () => ({
  getPassBySerial: (...a: unknown[]) => mockGetPassBySerial(...a),
}))
vi.mock("@/lib/wallet/customer", () => ({
  fetchCustomerPassData: (...a: unknown[]) => mockFetchCustomerPassData(...a),
}))
vi.mock("@/lib/wallet/pass", () => ({
  buildPass: (...a: unknown[]) => mockBuildPass(...a),
}))

import { GET } from "./route"

const SERIAL = "mb-4311-109853fd"
const PASS_TYPE = "pass.com.mandysbubbletea.membercard"

function ctx() {
  return { params: Promise.resolve({ passTypeIdentifier: PASS_TYPE, serialNumber: SERIAL }) }
}

function req(headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/wallet/v1/passes/${PASS_TYPE}/${SERIAL}`, {
    method: "GET",
    headers,
  })
}

const PASS = {
  serial_number: SERIAL,
  auth_token: "tok",
  member_number: "4311",
  customer_id: "CUST1",
  updated_at: "2026-06-14T00:00:00Z",
}

const PASS_DATA = {
  customerId: "CUST1",
  memberName: "Stan",
  memberSince: "Jan 2026",
  phoneE164: "+61404978238",
  stars: 3,
  lifetimePoints: 71,
  availableRewards: 0,
}

describe("GET /api/wallet/v1/passes/[passTypeIdentifier]/[serialNumber]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerifyAuth.mockResolvedValue(true)
    mockGetPassBySerial.mockResolvedValue(PASS)
    mockFetchCustomerPassData.mockResolvedValue(PASS_DATA)
    mockBuildPass.mockResolvedValue(Buffer.from("PKPASS"))
  })

  it("returns 401 when Apple pass auth fails", async () => {
    mockVerifyAuth.mockResolvedValue(false)
    const res = await GET(req({ authorization: "ApplePass bad" }), ctx())
    expect(res.status).toBe(401)
    expect(mockFetchCustomerPassData).not.toHaveBeenCalled()
  })

  it("returns 404 when the serial is unknown", async () => {
    mockGetPassBySerial.mockResolvedValue(null)
    const res = await GET(req(), ctx())
    expect(res.status).toBe(404)
  })

  it("returns the pkpass on the happy path", async () => {
    const res = await GET(req(), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/vnd.apple.pkpass")
  })

  it("returns 304 when the pass is unchanged since If-Modified-Since", async () => {
    const res = await GET(req({ "if-modified-since": "2026-06-15T00:00:00Z" }), ctx())
    expect(res.status).toBe(304)
    expect(mockFetchCustomerPassData).not.toHaveBeenCalled()
  })

  // The escalation fix: when Square rate-limits the loyalty lookup the route
  // must NOT bubble a 500 (which makes Apple's passd retry aggressively and
  // amplify the rate-limit storm). Returning 304 tells the device "no change",
  // so it keeps the current pass and backs off to its normal poll cadence.
  it("returns 304 (not 500) when Square rate-limits the pass data fetch", async () => {
    mockFetchCustomerPassData.mockRejectedValue(new Error("Status code: 429"))
    const res = await GET(req(), ctx())
    expect(res.status).toBe(304)
  })

  it("returns 304 when building the pass throws", async () => {
    mockBuildPass.mockRejectedValue(new Error("asset missing"))
    const res = await GET(req(), ctx())
    expect(res.status).toBe(304)
  })
})
