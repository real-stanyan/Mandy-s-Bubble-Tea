import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRange = vi.fn()
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        order: () => ({
          range: (...a: unknown[]) => mockRange(...a),
        }),
      }),
    }),
  }),
}))

import { listAllPassSerials } from "./db"

describe("listAllPassSerials", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns every serial from a single page", async () => {
    mockRange.mockResolvedValueOnce({
      data: [{ serial_number: "s1" }, { serial_number: "s2" }, { serial_number: "s3" }],
      error: null,
    })
    const serials = await listAllPassSerials()
    expect(serials).toEqual(["s1", "s2", "s3"])
    expect(mockRange).toHaveBeenCalledTimes(1)
    expect(mockRange).toHaveBeenCalledWith(0, 999)
  })

  it("paginates until a short page is returned", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({ serial_number: `s${i}` }))
    mockRange
      .mockResolvedValueOnce({ data: fullPage, error: null })
      .mockResolvedValueOnce({ data: [{ serial_number: "last1" }, { serial_number: "last2" }], error: null })
    const serials = await listAllPassSerials()
    expect(serials).toHaveLength(1002)
    expect(serials[serials.length - 1]).toBe("last2")
    expect(mockRange).toHaveBeenCalledTimes(2)
    expect(mockRange).toHaveBeenNthCalledWith(1, 0, 999)
    expect(mockRange).toHaveBeenNthCalledWith(2, 1000, 1999)
  })

  it("throws on a Supabase error", async () => {
    mockRange.mockResolvedValueOnce({ data: null, error: { message: "boom" } })
    await expect(listAllPassSerials()).rejects.toThrow("listAllPassSerials: boom")
  })
})
