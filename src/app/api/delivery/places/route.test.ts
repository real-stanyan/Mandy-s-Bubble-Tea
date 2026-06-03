import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

const KEY = "test-key";
beforeEach(() => {
  process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY = KEY;
  vi.restoreAllMocks();
});

function req(body: unknown) {
  return new Request("http://x/api/delivery/places", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

it("autocomplete returns predictions", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({
      status: "OK",
      predictions: [{ description: "1 Test St, Southport QLD", place_id: "p1" }],
    })),
  ));
  const res = await POST(req({ input: "1 Test", sessionToken: "s1" }));
  const json = await res.json();
  expect(json.predictions).toEqual([{ description: "1 Test St, Southport QLD", placeId: "p1" }]);
});

it("details returns address + lat/lng + postcode", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({
      status: "OK",
      result: {
        formatted_address: "1 Test St, Southport QLD 4215, Australia",
        geometry: { location: { lat: -27.97, lng: 153.41 } },
        address_components: [{ long_name: "4215", types: ["postal_code"] }],
      },
    })),
  ));
  const res = await POST(req({ placeId: "p1" }));
  const json = await res.json();
  expect(json).toEqual({
    address: "1 Test St, Southport QLD 4215, Australia",
    lat: -27.97,
    lng: 153.41,
    postcode: "4215",
  });
});

it("rejects empty body", async () => {
  const res = await POST(req({}));
  expect(res.status).toBe(400);
});

it("returns 502 when google fetch throws", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
  const res = await POST(req({ input: "1 Test", sessionToken: "s1" }));
  expect(res.status).toBe(502);
});
