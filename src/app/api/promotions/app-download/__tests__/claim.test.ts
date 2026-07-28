import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/app-download-discount", () => ({
  claimAppDownloadDiscount: vi.fn(),
  getAppDownloadDiscountStatus: vi.fn(),
}));

import {
  claimAppDownloadDiscount,
  getAppDownloadDiscountStatus,
} from "@/lib/app-download-discount";
import { POST } from "../claim/route";

const mockedClaim = vi.mocked(claimAppDownloadDiscount);
const mockedStatus = vi.mocked(getAppDownloadDiscountStatus);

const status = (redeemedAt: string | null) => ({
  available: redeemedAt == null,
  percentage: 20,
  claimedAt: "2026-07-27T00:00:00Z",
  redeemedAt,
});

function makeReq(body?: unknown) {
  return new Request("http://localhost/api/promotions/app-download/claim", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/promotions/app-download/claim", () => {
  it("returns 400 on invalid JSON", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
    expect(mockedClaim).not.toHaveBeenCalled();
  });

  it("returns 400 when phone is missing", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    expect(mockedClaim).not.toHaveBeenCalled();
  });

  it("returns 400 when phone is unparseable", async () => {
    const res = await POST(makeReq({ phone: "not-a-number" }));
    expect(res.status).toBe(400);
    expect(mockedClaim).not.toHaveBeenCalled();
  });

  it("normalizes the phone to E.164 before claiming", async () => {
    mockedClaim.mockResolvedValue({ alreadyClaimed: false });
    const res = await POST(makeReq({ phone: "0400 000 001" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, alreadyClaimed: false, redeemed: false });
    expect(mockedClaim).toHaveBeenCalledWith("+61400000001");
  });

  it("skips the status read on a fresh claim — nothing to look up", async () => {
    mockedClaim.mockResolvedValue({ alreadyClaimed: false });
    await POST(makeReq({ phone: "+61400000001" }));
    expect(mockedStatus).not.toHaveBeenCalled();
  });

  it("returns alreadyClaimed=true on a repeat claim (idempotent)", async () => {
    mockedClaim.mockResolvedValue({ alreadyClaimed: true });
    mockedStatus.mockResolvedValue(status(null));
    const res = await POST(makeReq({ phone: "+61400000002" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, alreadyClaimed: true, redeemed: false });
    expect(mockedClaim).toHaveBeenCalledWith("+61400000002");
  });

  // The popup needs this to say "you've already used it" instead of "your 20%
  // is waiting" — a lie the visitor would otherwise discover at checkout.
  it("reports redeemed=true when the grant was already spent", async () => {
    mockedClaim.mockResolvedValue({ alreadyClaimed: true });
    mockedStatus.mockResolvedValue(status("2026-07-27T01:00:00Z"));
    const res = await POST(makeReq({ phone: "+61400000003" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      alreadyClaimed: true,
      redeemed: true,
    });
    expect(mockedStatus).toHaveBeenCalledWith("+61400000003");
  });
});
