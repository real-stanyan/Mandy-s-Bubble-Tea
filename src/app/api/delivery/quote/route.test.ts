import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAuthedUser: vi.fn(),
}));
vi.mock("@/lib/store-status-server", () => ({
  isDeliveryEnabled: vi.fn(),
}));
vi.mock("@/lib/delivery-hours", () => ({
  isDeliveryHoursOpen: vi.fn().mockReturnValue(true),
}));

import { POST } from "./route";
import { getAuthedUser } from "@/lib/auth";
import { isDeliveryEnabled } from "@/lib/store-status-server";

function quoteRequest(body: unknown): Request {
  return new Request("http://test/api/delivery/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  address: "34 Davenport St, Southport",
  lat: -27.96,
  lng: 153.41,
  postcode: "4215",
  drinksSubtotalCents: 0,
};

describe("POST /api/delivery/quote — delivery toggle gate", () => {
  beforeEach(() => {
    vi.mocked(getAuthedUser).mockReset();
    vi.mocked(isDeliveryEnabled).mockReset();
    // Authenticated customer with a phone (passes the auth gate).
    vi.mocked(getAuthedUser).mockResolvedValue({
      profile: { phone_e164: "+61400000000" },
    } as Awaited<ReturnType<typeof getAuthedUser>>);
  });

  it("delivery switched OFF → { ok:false, reason:'unavailable' }", async () => {
    vi.mocked(isDeliveryEnabled).mockResolvedValue(false);
    const res = await POST(quoteRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: "unavailable" });
  });

  it("delivery ON → gate passes through to eligibility checks", async () => {
    vi.mocked(isDeliveryEnabled).mockResolvedValue(true);
    // subtotal 0 ⇒ below minimum ⇒ proves the toggle gate did not short-circuit.
    const res = await POST(quoteRequest(VALID_BODY));
    expect(await res.json()).toEqual({ ok: false, reason: "min_order" });
  });
});

describe("POST /api/delivery/quote — fee math on the POST-discount paid amount", () => {
  // DE848's real destination: 3.70km from the store → 3–4km band
  // ($5.99, free at/above $35).
  const DEST = {
    address: "6 Ashbourne Terrace, Biggera Waters",
    lat: -27.9347357,
    lng: 153.398581,
    postcode: "4216",
  };

  beforeEach(() => {
    vi.mocked(getAuthedUser).mockReset();
    vi.mocked(isDeliveryEnabled).mockReset();
    vi.mocked(getAuthedUser).mockResolvedValue({
      profile: { phone_e164: "+61400000000" },
    } as Awaited<ReturnType<typeof getAuthedUser>>);
    vi.mocked(isDeliveryEnabled).mockResolvedValue(true);
  });

  it("DE848 shape: pre $35.60 / paid $26.60 → $5.99 fee + $1.33 svc (not free)", async () => {
    const res = await POST(
      quoteRequest({
        ...DEST,
        drinksSubtotalCents: 3560,
        paidDrinksSubtotalCents: 2660,
      }),
    );
    expect(await res.json()).toEqual({ ok: true, feeCents: 599, serviceFeeCents: 133 });
  });

  it("paid omitted (old App client) → falls back to pre-discount: $35.60 stays FREE", async () => {
    const res = await POST(quoteRequest({ ...DEST, drinksSubtotalCents: 3560 }));
    expect(await res.json()).toEqual({ ok: true, feeCents: 0, serviceFeeCents: 178 });
  });

  it("full star redeem: paid $0 still pays the band fee, svc $0", async () => {
    const res = await POST(
      quoteRequest({
        ...DEST,
        drinksSubtotalCents: 1760,
        paidDrinksSubtotalCents: 0,
      }),
    );
    expect(await res.json()).toEqual({ ok: true, feeCents: 599, serviceFeeCents: 0 });
  });

  it("forged paid above pre is clamped to pre (can't fake the free threshold)", async () => {
    const res = await POST(
      quoteRequest({
        ...DEST,
        drinksSubtotalCents: 2000,
        paidDrinksSubtotalCents: 99999,
      }),
    );
    expect(await res.json()).toEqual({ ok: true, feeCents: 599, serviceFeeCents: 100 });
  });

  it("eligibility ($12 min) still judges the PRE-discount subtotal", async () => {
    // pre $13 / paid $0 → eligible (min gate uses pre), fee on paid.
    const res = await POST(
      quoteRequest({
        ...DEST,
        drinksSubtotalCents: 1300,
        paidDrinksSubtotalCents: 0,
      }),
    );
    expect(await res.json()).toEqual({ ok: true, feeCents: 599, serviceFeeCents: 0 });
  });
});
