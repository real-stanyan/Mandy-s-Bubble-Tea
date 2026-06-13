import { describe, it, expect, vi, beforeEach } from "vitest"

const mockList = vi.fn()
vi.mock("@/lib/wallet/db", () => ({
  listAllPassSerials: () => mockList(),
}))

const mockPublish = vi.fn()
vi.mock("@upstash/qstash", () => ({
  Client: class {
    publishJSON = (...a: unknown[]) => mockPublish(...a)
  },
}))

vi.mock("@/lib/wallet/env", () => ({
  walletEnv: () => ({
    qstashToken: "qtoken",
    qstashUrl: "https://qstash.example",
    webServiceUrl: "https://mandybubbletea.com/api/wallet",
  }),
}))

import { POST } from "./route"

const TOKEN = "test-staff-token"

function req(headers: Record<string, string>, body: unknown): Request {
  return new Request("http://localhost/api/wallet/admin/repush-all", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

describe("POST /api/wallet/admin/repush-all", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STAFF_DELIVERY_TOKEN = TOKEN
    mockList.mockResolvedValue(["s1", "s2", "s3"])
    mockPublish.mockResolvedValue({})
  })

  it("rejects a request without the staff Bearer token", async () => {
    const res = await POST(req({}, { apply: true }))
    expect(res.status).toBe(401)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it("defaults to dry-run: reports the total but enqueues nothing", async () => {
    const res = await POST(req({ authorization: `Bearer ${TOKEN}` }, {}))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.dryRun).toBe(true)
    expect(json.total).toBe(3)
    expect(json.enqueued).toBe(0)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it("enqueues one worker job per serial when apply is true", async () => {
    const res = await POST(req({ authorization: `Bearer ${TOKEN}` }, { apply: true }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.dryRun).toBe(false)
    expect(json.total).toBe(3)
    expect(json.enqueued).toBe(3)
    expect(mockPublish).toHaveBeenCalledTimes(3)
    const firstCall = mockPublish.mock.calls[0][0]
    expect(firstCall.url).toBe("https://mandybubbletea.com/api/wallet/worker/push")
    expect(firstCall.body).toEqual({ serialNumber: "s1" })
  })

  it("continues the batch and records failures when one enqueue throws", async () => {
    mockPublish
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("qstash 503"))
      .mockResolvedValueOnce({})
    const res = await POST(req({ authorization: `Bearer ${TOKEN}` }, { apply: true }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(false)
    expect(json.enqueued).toBe(2)
    expect(json.failures).toHaveLength(1)
    expect(json.failures[0].serial).toBe("s2")
  })
})
