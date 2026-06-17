import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSearchEvents = vi.fn();
const mockFindAccount = vi.fn();
const mockGetAuthedUser = vi.fn();

vi.mock("@/lib/square", () => ({
  squareClient: {
    loyalty: {
      searchEvents: (...args: unknown[]) => mockSearchEvents(...args),
    },
  },
}));

vi.mock("@/lib/utils", () => ({
  serializeSquareResponse: (x: unknown) => x,
}));

vi.mock("@/lib/loyalty", () => ({
  findLoyaltyAccountByPhone: (...args: unknown[]) => mockFindAccount(...args),
}));

vi.mock("@/lib/auth", () => ({
  getAuthedUser: (...args: unknown[]) => mockGetAuthedUser(...args),
}));

import { GET } from "./route";

const req = () => new Request("http://localhost/api/loyalty/events");

// Build N synthetic ACCUMULATE events.
function page(n: number, startId: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `ev${startId + i}`,
    type: "ACCUMULATE_POINTS",
    createdAt: "2026-06-01T00:00:00Z",
    accumulatePoints: { points: 1, orderId: `ord${startId + i}` },
  }));
}

describe("GET /api/loyalty/events — pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthedUser.mockResolvedValue({
      profile: { phone_e164: "+61400000000" },
    });
    mockFindAccount.mockResolvedValue({
      accountId: "acc1",
      balance: 9,
      lifetimePoints: 100,
    });
  });

  it("merges all pages following Square's cursor (newest-first preserved)", async () => {
    mockSearchEvents
      .mockResolvedValueOnce({ events: page(30, 1), cursor: "c1" })
      .mockResolvedValueOnce({ events: page(5, 31), cursor: undefined });

    const res = await GET(req());
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.events).toHaveLength(35);
    expect(json.events[0].id).toBe("ev1");
    expect(json.events[34].id).toBe("ev35");
    // cursor threaded into the second call
    expect(mockSearchEvents).toHaveBeenCalledTimes(2);
    expect(mockSearchEvents.mock.calls[0][0].cursor).toBeUndefined();
    expect(mockSearchEvents.mock.calls[1][0].cursor).toBe("c1");
  });

  it("caps at 100 events even if Square keeps returning a cursor", async () => {
    mockSearchEvents.mockImplementation((arg: { cursor?: string }) => {
      const start = arg.cursor ? Number(arg.cursor) : 1;
      return Promise.resolve({
        events: page(30, start),
        cursor: String(start + 30),
      });
    });

    const res = await GET(req());
    const json = await res.json();

    expect(json.events).toHaveLength(100);
    // 4 pages of 30 = 120 fetched, then the loop stops (>= 100); sliced to 100.
    expect(mockSearchEvents).toHaveBeenCalledTimes(4);
  });

  it("returns empty when the user has no phone", async () => {
    mockGetAuthedUser.mockResolvedValue({ profile: {} });
    const res = await GET(req());
    const json = await res.json();
    expect(json).toEqual({ ok: true, events: [] });
    expect(mockSearchEvents).not.toHaveBeenCalled();
  });

  it("returns empty when no loyalty account is found", async () => {
    mockFindAccount.mockResolvedValue(null);
    const res = await GET(req());
    const json = await res.json();
    expect(json).toEqual({ ok: true, events: [] });
    expect(mockSearchEvents).not.toHaveBeenCalled();
  });

  it("502s when Square throws", async () => {
    mockSearchEvents.mockRejectedValue(new Error("square down"));
    const res = await GET(req());
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
});
