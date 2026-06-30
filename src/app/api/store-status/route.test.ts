import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/store-status-server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store-status-server")>(
    "@/lib/store-status-server",
  );
  return {
    ...actual,
    getEffectiveOrderingStatus: vi.fn(),
    isDeliveryEnabled: vi.fn(),
  };
});

import {
  getEffectiveOrderingStatus,
  isDeliveryEnabled,
} from "@/lib/store-status-server";

describe("GET /api/store-status", () => {
  beforeEach(() => {
    vi.mocked(getEffectiveOrderingStatus).mockReset();
    vi.mocked(isDeliveryEnabled).mockReset();
  });

  it("returns effective status JSON with the live delivery flag", async () => {
    vi.mocked(getEffectiveOrderingStatus).mockResolvedValue({
      open: true,
      nextLabel: "until 10:30pm",
    });
    vi.mocked(isDeliveryEnabled).mockResolvedValue(true);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      open: true,
      nextLabel: "until 10:30pm",
      deliveryEnabled: true,
    });
  });

  it("reflects delivery switched off", async () => {
    vi.mocked(getEffectiveOrderingStatus).mockResolvedValue({
      open: true,
      nextLabel: "until 10:30pm",
    });
    vi.mocked(isDeliveryEnabled).mockResolvedValue(false);
    const res = await GET();
    expect((await res.json()).deliveryEnabled).toBe(false);
  });

  it("sets edge-cache header", async () => {
    vi.mocked(getEffectiveOrderingStatus).mockResolvedValue({
      open: false,
      nextLabel: "Opens 10:30am",
    });
    vi.mocked(isDeliveryEnabled).mockResolvedValue(true);
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=30");
  });
});
