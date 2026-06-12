import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAuthedUser = vi.fn();
const mockGetToppingAllowanceStatus = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuthedUser: (req: Request) => mockGetAuthedUser(req),
}));
vi.mock("@/lib/tier-toppings-store", () => ({
  getToppingAllowanceStatus: (...args: unknown[]) =>
    mockGetToppingAllowanceStatus(...args),
}));

import { GET } from "./route";
import { DIAMOND_MONTHLY_FREE_TOPPINGS, brisbaneMonthKey } from "@/lib/membership-tier";

function makeRequest() {
  return new Request("http://localhost/api/tier/toppings");
}

describe("GET /api/tier/toppings — diamond topping quota", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns remaining:0 and limit without calling getToppingAllowanceStatus when user is unauthenticated", async () => {
    mockGetAuthedUser.mockResolvedValue(null);

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      remaining: 0,
      limit: DIAMOND_MONTHLY_FREE_TOPPINGS,
    });
    expect(DIAMOND_MONTHLY_FREE_TOPPINGS).toBe(10);
    expect(mockGetToppingAllowanceStatus).not.toHaveBeenCalled();
  });

  it("returns status remaining and monthKey for authenticated user with square_customer_id", async () => {
    mockGetAuthedUser.mockResolvedValue({
      userId: "u1",
      profile: {
        square_customer_id: "cust1",
        phone_e164: "+61400000001",
      },
    });
    const expectedMonthKey = brisbaneMonthKey();
    mockGetToppingAllowanceStatus.mockResolvedValue({
      usedCount: 4,
      remaining: 6,
      monthKey: expectedMonthKey,
    });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      remaining: 6,
      limit: DIAMOND_MONTHLY_FREE_TOPPINGS,
      monthKey: expectedMonthKey,
    });
    expect(mockGetToppingAllowanceStatus).toHaveBeenCalledTimes(1);
    expect(mockGetToppingAllowanceStatus).toHaveBeenCalledWith(
      "cust1",
      expectedMonthKey,
    );
  });
});
