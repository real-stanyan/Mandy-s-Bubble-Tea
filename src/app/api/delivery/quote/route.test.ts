import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAuthedUser: vi.fn(),
}));
vi.mock("@/lib/store-status-server", () => ({
  isDeliveryEnabled: vi.fn(),
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
