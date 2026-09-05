import { describe, it, expect, vi, beforeEach } from "vitest"

const mockBump = vi.fn()
const mockGetTokens = vi.fn()
const mockDelete = vi.fn()
const mockPush = vi.fn()

vi.mock("./db", () => ({
  bumpPassUpdatedAt: (...a: unknown[]) => mockBump(...a),
  getDevicePushTokens: (...a: unknown[]) => mockGetTokens(...a),
  deleteDeviceByPushToken: (...a: unknown[]) => mockDelete(...a),
}))
vi.mock("./apns", () => ({
  pushToAppleWallet: (...a: unknown[]) => mockPush(...a),
}))
const mockGoogleSync = vi.fn()
vi.mock("./google/sync", () => ({
  syncGoogleObject: (...a: unknown[]) => mockGoogleSync(...a),
}))

import { repushPass } from "./repush"

describe("repushPass", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGoogleSync.mockResolvedValue("skipped")
  })

  it("bumps updated_at then pushes every registered device", async () => {
    mockGetTokens.mockResolvedValue(["tokA", "tokB"])
    mockPush.mockResolvedValue([
      { token: "tokA", status: 200 },
      { token: "tokB", status: 200 },
    ])

    const r = await repushPass("mb-4406-35814361")

    expect(mockBump).toHaveBeenCalledWith("mb-4406-35814361")
    expect(mockPush).toHaveBeenCalledWith(["tokA", "tokB"])
    expect(r).toEqual({ serial: "mb-4406-35814361", pushed: 2, failures: [], google: "skipped" })
  })

  it("prunes devices that report 410 gone", async () => {
    mockGetTokens.mockResolvedValue(["dead", "live"])
    mockPush.mockResolvedValue([
      { token: "dead", status: 410 },
      { token: "live", status: 200 },
    ])

    const r = await repushPass("s1")

    expect(mockDelete).toHaveBeenCalledWith("dead")
    expect(mockDelete).not.toHaveBeenCalledWith("live")
    expect(r.failures).toEqual([])
  })

  it("reports 5xx/429 as failures (so the worker can 500 + retry)", async () => {
    mockGetTokens.mockResolvedValue(["t1"])
    mockPush.mockResolvedValue([{ token: "t1", status: 503, reason: "ServiceUnavailable" }])

    const r = await repushPass("s2")

    expect(r.failures).toEqual([{ token: "t1", status: 503, reason: "ServiceUnavailable" }])
  })

  it("handles a pass with no registered devices", async () => {
    mockGetTokens.mockResolvedValue([])
    mockPush.mockResolvedValue([])

    const r = await repushPass("s3")

    expect(mockBump).toHaveBeenCalledWith("s3")
    expect(r).toEqual({ serial: "s3", pushed: 0, failures: [], google: "skipped" })
  })

  it("rewrites the Google object after the Apple push and reports it", async () => {
    mockGetTokens.mockResolvedValue([])
    mockPush.mockResolvedValue([])
    mockGoogleSync.mockResolvedValue("updated")

    const r = await repushPass("mb-4406-35814361")

    expect(mockGoogleSync).toHaveBeenCalledWith("mb-4406-35814361")
    expect(r.google).toBe("updated")
  })

  it("a Google failure is reported, never thrown over the Apple result", async () => {
    mockGetTokens.mockResolvedValue(["tokA"])
    mockPush.mockResolvedValue([{ token: "tokA", status: 200 }])
    mockGoogleSync.mockRejectedValue(new Error("403 from Google"))

    const r = await repushPass("mb-4406-35814361")

    expect(r.pushed).toBe(1)
    expect(r.google).toBe("failed")
  })
})
