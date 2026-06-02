import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getAuthedUser: vi.fn() }));
vi.mock("@/lib/ig-follow-discount", () => ({ claimIgFollowDiscount: vi.fn() }));

import { getAuthedUser } from "@/lib/auth";
import { claimIgFollowDiscount } from "@/lib/ig-follow-discount";
import { POST } from "../claim/route";

const mockedGetAuthed = vi.mocked(getAuthedUser);
const mockedClaim = vi.mocked(claimIgFollowDiscount);

function makeReq() {
  return new Request("http://localhost/api/promotions/ig-follow/claim", {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/promotions/ig-follow/claim", () => {
  it("returns 401 when not signed in", async () => {
    mockedGetAuthed.mockResolvedValue(null);
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect(mockedClaim).not.toHaveBeenCalled();
  });

  it("returns 404 when profile has no Square customer id", async () => {
    mockedGetAuthed.mockResolvedValue({
      userId: "u1",
      email: null,
      phone: null,
      profile: { square_customer_id: null, phone_e164: null },
    } as never);
    const res = await POST(makeReq());
    expect(res.status).toBe(404);
    expect(mockedClaim).not.toHaveBeenCalled();
  });

  it("mints ticket on first claim", async () => {
    mockedGetAuthed.mockResolvedValue({
      userId: "u1",
      profile: { square_customer_id: "CUST_NEW" },
    } as never);
    mockedClaim.mockResolvedValue({ alreadyClaimed: false });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, alreadyClaimed: false });
    expect(mockedClaim).toHaveBeenCalledWith("CUST_NEW");
  });

  it("returns alreadyClaimed=true on second claim (idempotent)", async () => {
    mockedGetAuthed.mockResolvedValue({
      userId: "u1",
      profile: { square_customer_id: "CUST_OLD" },
    } as never);
    mockedClaim.mockResolvedValue({ alreadyClaimed: true });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, alreadyClaimed: true });
  });
});
