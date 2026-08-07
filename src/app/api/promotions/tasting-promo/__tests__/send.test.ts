import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin-auth", () => ({ getAdminUserId: vi.fn() }));
vi.mock("@/lib/push-tokens", () => ({ getAllDevicePushTokens: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendExpoPush: vi.fn() }));
// The copy builder is the real one — the point of these tests is that what
// goes out is derived from the promo row, not from the request body.
vi.mock("@/lib/tasting-promo", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/tasting-promo")>(
      "@/lib/tasting-promo",
    );
  return {
    ...actual,
    getTastingPromoByKey: vi.fn(),
    claimTastingPromoPush: vi.fn(),
    releaseTastingPromoPush: vi.fn(),
  };
});

import { getAdminUserId } from "@/lib/admin-auth";
import { getAllDevicePushTokens } from "@/lib/push-tokens";
import { sendExpoPush } from "@/lib/push";
import {
  claimTastingPromoPush,
  getTastingPromoByKey,
  releaseTastingPromoPush,
} from "@/lib/tasting-promo";
import { POST } from "../send/route";

const KEY = "strawberry-matcha-2026-08";

/** A promo whose window is open well past any test clock. */
const livePromo = (over: Partial<Record<string, unknown>> = {}) => ({
  key: KEY,
  productName: "Strawberry Matcha Milk Tea",
  tastingPriceCents: 500,
  startsAt: "2026-08-07T00:00:00Z",
  endsAt: "2099-01-01T00:00:00Z",
  active: true,
  pushedAt: null,
  ...over,
});

function makeReq(body?: unknown) {
  return new Request("http://localhost/api/promotions/tasting-promo/send", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAdminUserId).mockResolvedValue("admin-1");
  vi.mocked(getTastingPromoByKey).mockResolvedValue(livePromo());
  vi.mocked(claimTastingPromoPush).mockResolvedValue(true);
  vi.mocked(getAllDevicePushTokens).mockResolvedValue([
    "ExponentPushToken[a]",
    "ExponentPushToken[b]",
  ]);
  vi.mocked(sendExpoPush).mockResolvedValue(2);
});

describe("POST /api/promotions/tasting-promo/send", () => {
  it("refuses a caller who isn't an admin", async () => {
    vi.mocked(getAdminUserId).mockResolvedValue(null);
    const res = await POST(makeReq({ promoKey: KEY }));
    expect(res.status).toBe(401);
    expect(sendExpoPush).not.toHaveBeenCalled();
  });

  it("requires a promoKey", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    expect(sendExpoPush).not.toHaveBeenCalled();
  });

  it("404s when the promo row does not exist", async () => {
    vi.mocked(getTastingPromoByKey).mockResolvedValue(null);
    const res = await POST(makeReq({ promoKey: KEY }));
    expect(res.status).toBe(404);
    expect(sendExpoPush).not.toHaveBeenCalled();
  });

  it("announces the price from the row, not from the body", async () => {
    const res = await POST(makeReq({ promoKey: KEY }));
    expect(res.status).toBe(200);
    const [, payload] = vi.mocked(sendExpoPush).mock.calls[0];
    expect(payload.title).toBe("🧋 New Taste — Strawberry Matcha Milk Tea");
    expect(payload.body).toContain("$5.00");
    expect(payload.data).toMatchObject({ type: "tasting-promo", url: "/menu" });
  });

  it("rejects a body that disagrees with the row about the money", async () => {
    const res = await POST(
      makeReq({ promoKey: KEY, tastingPriceCents: 300 }),
    );
    expect(res.status).toBe(409);
    expect(sendExpoPush).not.toHaveBeenCalled();
  });

  it("rejects a body that disagrees about the product", async () => {
    const res = await POST(
      makeReq({ promoKey: KEY, productName: "Taro Milk Tea" }),
    );
    expect(res.status).toBe(409);
    expect(sendExpoPush).not.toHaveBeenCalled();
  });

  it("will not announce a promo whose window has closed", async () => {
    vi.mocked(getTastingPromoByKey).mockResolvedValue(
      livePromo({ endsAt: "2026-08-01T00:00:00Z" }),
    );
    const res = await POST(makeReq({ promoKey: KEY }));
    expect(res.status).toBe(409);
    expect(sendExpoPush).not.toHaveBeenCalled();
  });

  it("will not announce an inactive promo", async () => {
    vi.mocked(getTastingPromoByKey).mockResolvedValue(
      livePromo({ active: false }),
    );
    const res = await POST(makeReq({ promoKey: KEY }));
    expect(res.status).toBe(409);
  });

  it("refuses a second announcement", async () => {
    vi.mocked(getTastingPromoByKey).mockResolvedValue(
      livePromo({ pushedAt: "2026-08-07T06:00:00Z" }),
    );
    const res = await POST(makeReq({ promoKey: KEY }));
    expect(res.status).toBe(409);
    expect(sendExpoPush).not.toHaveBeenCalled();
  });

  it("sends a second wave when force is set", async () => {
    vi.mocked(getTastingPromoByKey).mockResolvedValue(
      livePromo({ pushedAt: "2026-08-07T06:00:00Z" }),
    );
    const res = await POST(makeReq({ promoKey: KEY, force: true }));
    expect(res.status).toBe(200);
    expect(sendExpoPush).toHaveBeenCalledOnce();
    // The row is already stamped; forcing must not re-claim it.
    expect(claimTastingPromoPush).not.toHaveBeenCalled();
  });

  it("loses the race rather than double-pushing", async () => {
    vi.mocked(claimTastingPromoPush).mockResolvedValue(false);
    const res = await POST(makeReq({ promoKey: KEY }));
    expect(res.status).toBe(409);
    expect(sendExpoPush).not.toHaveBeenCalled();
  });

  it("releases the claim when there is nobody to notify", async () => {
    vi.mocked(getAllDevicePushTokens).mockResolvedValue([]);
    const res = await POST(makeReq({ promoKey: KEY }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ sent: false });
    // Otherwise the promo is marked announced and can never be sent again.
    expect(releaseTastingPromoPush).toHaveBeenCalledWith(KEY);
  });

  it("releases the claim when the audience lookup blows up", async () => {
    vi.mocked(getAllDevicePushTokens).mockRejectedValue(new Error("no table"));
    const res = await POST(makeReq({ promoKey: KEY }));
    expect(res.status).toBe(502);
    expect(releaseTastingPromoPush).toHaveBeenCalledWith(KEY);
  });

  it("lets an admin override the copy within length limits", async () => {
    const res = await POST(
      makeReq({ promoKey: KEY, title: "Hi", body: "x".repeat(400) }),
    );
    expect(res.status).toBe(200);
    const [, payload] = vi.mocked(sendExpoPush).mock.calls[0];
    expect(payload.title).toBe("Hi");
    expect(payload.body).toHaveLength(300);
  });
});
