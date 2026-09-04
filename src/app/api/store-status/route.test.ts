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
    getDeliveryPause: vi.fn(),
  };
});

// kitchen-load-server reaches for the Square client at module scope.
const { getKitchenLoad } = vi.hoisted(() => ({ getKitchenLoad: vi.fn() }));
vi.mock("@/lib/kitchen-load-server", () => ({ getKitchenLoad }));

import {
  getEffectiveOrderingStatus,
  getDeliveryPause,
  isDeliveryEnabled,
} from "@/lib/store-status-server";

describe("GET /api/store-status", () => {
  beforeEach(() => {
    vi.mocked(getEffectiveOrderingStatus).mockReset();
    vi.mocked(isDeliveryEnabled).mockReset();
    vi.mocked(getDeliveryPause).mockReset();
    vi.mocked(getDeliveryPause).mockResolvedValue(null);
    getKitchenLoad.mockReset();
    getKitchenLoad.mockResolvedValue(null);
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
      deliveryPause: null,
      kitchen: null,
    });
  });

  it("passes the live kitchen load through for the ASAP estimate", async () => {
    // "~10 min" was a constant; the estimate now follows the bench
    // (Stan, 2026-09-04). The route just relays what the server measured.
    vi.mocked(getEffectiveOrderingStatus).mockResolvedValue({
      open: true,
      nextLabel: "until 10:30pm",
    });
    vi.mocked(isDeliveryEnabled).mockResolvedValue(true);
    getKitchenLoad.mockResolvedValue({
      level: "busy",
      pendingCups: 14,
      minMinutes: 7,
      maxMinutes: 10,
      label: "7–10 min",
    });
    const body = await (await GET()).json();
    expect(body.kitchen).toEqual({
      level: "busy",
      pendingCups: 14,
      minMinutes: 7,
      maxMinutes: 10,
      label: "7–10 min",
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

describe("GET /api/store-status — maintenance pause", () => {
  beforeEach(() => {
    vi.mocked(getEffectiveOrderingStatus).mockReset();
    vi.mocked(isDeliveryEnabled).mockReset();
    vi.mocked(getDeliveryPause).mockReset();
  });

  it("passes the live pause through so the UI can say why", async () => {
    // "Delivery unavailable" with no reason reads as a broken site; the
    // reason and the return time are the whole point of this field.
    const pause = { until: "2026-08-11T07:00:00.000Z", reason: "maintenance" };
    vi.mocked(getEffectiveOrderingStatus).mockResolvedValue({
      open: true,
      nextLabel: "until 10:30pm",
    });
    vi.mocked(isDeliveryEnabled).mockResolvedValue(false);
    vi.mocked(getDeliveryPause).mockResolvedValue(pause);

    const body = await (await GET()).json();
    expect(body.deliveryEnabled).toBe(false);
    expect(body.deliveryPause).toEqual(pause);
  });
});
