import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRewardDelete = vi.fn()
vi.mock("@/lib/square", () => ({
  squareClient: {
    loyalty: { rewards: { delete: (...a: unknown[]) => mockRewardDelete(...a) } },
  },
  SQUARE_LOCATION_ID: "L1",
  findCustomerByPhone: vi.fn(),
}))

import { returnOrderRewards } from "@/lib/loyalty"

describe("returnOrderRewards", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("deletes every reward attached to the order and counts them", async () => {
    mockRewardDelete.mockResolvedValue({})
    const res = await returnOrderRewards({
      id: "O1",
      rewards: [{ id: "R1" }, { id: "R2" }],
    })
    expect(res.returned).toBe(2)
    expect(mockRewardDelete).toHaveBeenCalledTimes(2)
    expect(mockRewardDelete).toHaveBeenCalledWith({ rewardId: "R1" })
    expect(mockRewardDelete).toHaveBeenCalledWith({ rewardId: "R2" })
  })

  it("no-ops with zero deletes when there are no rewards", async () => {
    expect((await returnOrderRewards({ id: "O1", rewards: [] })).returned).toBe(0)
    expect((await returnOrderRewards({ id: "O1", rewards: null })).returned).toBe(0)
    expect((await returnOrderRewards({ id: "O1" })).returned).toBe(0)
    expect(mockRewardDelete).not.toHaveBeenCalled()
  })

  it("skips rewards without an id", async () => {
    mockRewardDelete.mockResolvedValue({})
    const res = await returnOrderRewards({
      id: "O1",
      rewards: [{ id: undefined }, { id: "R2" }],
    })
    expect(res.returned).toBe(1)
    expect(mockRewardDelete).toHaveBeenCalledTimes(1)
    expect(mockRewardDelete).toHaveBeenCalledWith({ rewardId: "R2" })
  })

  it("tolerates a per-reward delete failure and keeps going", async () => {
    mockRewardDelete
      .mockRejectedValueOnce(new Error("already deleted"))
      .mockResolvedValueOnce({})
    const res = await returnOrderRewards({
      id: "O1",
      rewards: [{ id: "R1" }, { id: "R2" }],
    })
    // R1 failed, R2 succeeded — count reflects only the successful return,
    // and the failure does not throw (must not block the order cancel).
    expect(res.returned).toBe(1)
    expect(mockRewardDelete).toHaveBeenCalledTimes(2)
  })
})
