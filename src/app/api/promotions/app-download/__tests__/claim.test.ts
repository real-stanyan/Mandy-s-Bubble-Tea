import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/app-download-discount", () => ({
  claimAppDownloadDiscount: vi.fn(),
}));

import { claimAppDownloadDiscount } from "@/lib/app-download-discount";
import { POST } from "../claim/route";

const mockedClaim = vi.mocked(claimAppDownloadDiscount);

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
    expect(body).toEqual({ ok: true, alreadyClaimed: false });
    expect(mockedClaim).toHaveBeenCalledWith("+61400000001");
  });

  it("returns alreadyClaimed=true on a repeat claim (idempotent)", async () => {
    mockedClaim.mockResolvedValue({ alreadyClaimed: true });
    const res = await POST(makeReq({ phone: "+61400000002" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, alreadyClaimed: true });
    expect(mockedClaim).toHaveBeenCalledWith("+61400000002");
  });
});
