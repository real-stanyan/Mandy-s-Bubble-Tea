import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRepush = vi.fn()
vi.mock("@/lib/wallet/repush", () => ({
  repushPass: (...a: unknown[]) => mockRepush(...a),
}))

import { POST } from "./route"

const TOKEN = "test-staff-token"

function req(headers: Record<string, string>, body: unknown): Request {
  return new Request("http://localhost/api/wallet/admin/repush", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

describe("POST /api/wallet/admin/repush", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STAFF_DELIVERY_TOKEN = TOKEN
  })

  it("rejects a request without the staff Bearer token", async () => {
    const res = await POST(req({}, { serials: ["s1"] }))
    expect(res.status).toBe(401)
    expect(mockRepush).not.toHaveBeenCalled()
  })

  it("re-pushes each supplied serial when authed", async () => {
    mockRepush.mockImplementation((s: string) =>
      Promise.resolve({ serial: s, pushed: 1, failures: [] }),
    )

    const res = await POST(
      req({ authorization: `Bearer ${TOKEN}` }, { serials: ["s1", "s2"] }),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(mockRepush).toHaveBeenCalledTimes(2)
    expect(json.results).toHaveLength(2)
  })

  it("400s when no serials are supplied", async () => {
    const res = await POST(req({ authorization: `Bearer ${TOKEN}` }, { serials: [] }))
    expect(res.status).toBe(400)
    expect(mockRepush).not.toHaveBeenCalled()
  })

  it("does not abort the batch when one serial throws", async () => {
    mockRepush.mockImplementation((s: string) =>
      s === "bad"
        ? Promise.reject(new Error("Square customer not found"))
        : Promise.resolve({ serial: s, pushed: 1, failures: [] }),
    )

    const res = await POST(
      req({ authorization: `Bearer ${TOKEN}` }, { serials: ["ok", "bad"] }),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.results).toHaveLength(2)
    const bad = json.results.find((r: { serial: string }) => r.serial === "bad")
    expect(bad.error).toContain("not found")
  })
})
