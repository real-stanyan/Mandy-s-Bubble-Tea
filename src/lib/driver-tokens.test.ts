import { describe, it, expect, vi, beforeEach } from "vitest"

const mockIn = vi.fn()
const mockSelect = vi.fn(() => ({ in: mockIn }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))
vi.mock("./supabase-server", () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}))

import { getDriverFixesForOrders } from "./driver-tokens"

describe("getDriverFixesForOrders", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns {} without querying when there are no order ids", async () => {
    expect(await getDriverFixesForOrders([])).toEqual({})
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("maps rows by order_id and skips rows with no fix yet", async () => {
    mockIn.mockResolvedValue({
      data: [
        {
          order_id: "O1",
          driver_lat: -27.9,
          driver_lng: 153.4,
          driver_heading: 90,
          location_updated_at: "2026-06-04T01:00:00Z",
        },
        { order_id: "O2", driver_lat: null, driver_lng: null, driver_heading: null, location_updated_at: null },
      ],
      error: null,
    })
    const fixes = await getDriverFixesForOrders(["O1", "O2"])
    expect(fixes).toEqual({
      O1: { lat: -27.9, lng: 153.4, heading: 90, updatedAt: "2026-06-04T01:00:00Z" },
    })
    expect(mockFrom).toHaveBeenCalledWith("delivery_dispatch")
    expect(mockIn).toHaveBeenCalledWith("order_id", ["O1", "O2"])
  })

  it("throws on a query error", async () => {
    mockIn.mockResolvedValue({ data: null, error: { message: "boom" } })
    await expect(getDriverFixesForOrders(["O1"])).rejects.toThrow("boom")
  })
})
