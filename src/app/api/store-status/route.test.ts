import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/store-status", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store-status")>(
    "@/lib/store-status",
  );
  return {
    ...actual,
    getEffectiveOrderingStatus: vi.fn(),
  };
});

import { getEffectiveOrderingStatus } from "@/lib/store-status";

describe("GET /api/store-status", () => {
  beforeEach(() => {
    vi.mocked(getEffectiveOrderingStatus).mockReset();
  });

  it("returns effective status JSON", async () => {
    vi.mocked(getEffectiveOrderingStatus).mockResolvedValue({
      open: true,
      nextLabel: "until 10:30pm",
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ open: true, nextLabel: "until 10:30pm" });
  });

  it("sets edge-cache header", async () => {
    vi.mocked(getEffectiveOrderingStatus).mockResolvedValue({
      open: false,
      nextLabel: "Opens 10:30am",
    });
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=30");
  });
});
