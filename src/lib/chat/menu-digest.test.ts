import { describe, it, expect, vi } from "vitest";

// Mock the Square client so catalog.ts doesn't require SQUARE_ACCESS_TOKEN at import time
vi.mock("@/lib/square", () => ({
  squareClient: { catalog: { list: vi.fn() } },
  SQUARE_LOCATION_ID: "test_location",
}));

import { buildMenuDigest } from "@/lib/chat/menu-digest";
import { fixtureMenu } from "@/lib/chat/__fixtures__/menu";

describe("buildMenuDigest", () => {
  const digest = buildMenuDigest(fixtureMenu());

  it("lists every item with its id so the model can cite one", () => {
    expect(digest).toContain("ITEM_TARO");
    expect(digest).toContain("Taro Milk Tea");
    expect(digest).toContain("ITEM_MANGO");
  });

  it("lists variations with ids and dollar prices", () => {
    expect(digest).toContain("ITEM_TARO_REG");
    expect(digest).toContain("$7.50");
    expect(digest).toContain("ITEM_TARO_LRG");
    expect(digest).toContain("$8.50");
  });

  it("marks preset drinks' fixed toppings as unremovable", () => {
    // ITEM_TOP10_TARO sits in the TOP 10 category, whose preset locks
    // toppings on. The model must see they can't be removed, or it
    // promises "without pearls" and the validator's force-seed makes the
    // card contradict it.
    const top10Line = digest
      .split("\n")
      .find((l) => l.includes("ITEM_TOP10_TARO"));
    expect(top10Line).toMatch(/FIXED toppings, cannot be removed:/);
    // Non-preset items carry no such marker.
    const plainLine = digest.split("\n").find((l) => l.includes("ITEM_MANGO"));
    expect(plainLine).not.toMatch(/FIXED toppings/);
  });

  it("marks sold-out items so the model stops offering them", () => {
    expect(digest).toMatch(/Winter Melon Tea.*SOLD OUT/);
  });

  it("omits sold-out modifiers entirely", () => {
    expect(digest).not.toContain("MOD_SOLDOUT");
    expect(digest).not.toContain("Taro Ball");
  });

  it("states each modifier list's selection bounds", () => {
    expect(digest).toMatch(/SUGAR.*pick exactly 1/);
    expect(digest).toMatch(/TOPPING.*optional.*max 3 different/);
  });

  it("groups items under their category slug", () => {
    expect(digest).toContain("milky");
    expect(digest).toContain("top-10");
  });

  it("stays small enough to cache cheaply", () => {
    // ~4 chars/token. The whole point of the digest is that it fits in a
    // cached system prompt; a blown budget means we regressed to dumping raw
    // catalog JSON.
    //
    // This fixture's digest is ~4.4k chars. 6,000 is tuned to that — real
    // headroom for the format growing a field or two, but tight enough that
    // a format regression (e.g. swapping the compact text lines for
    // pretty-printed JSON, which is the actual failure mode this test
    // guards against) still trips it. The old bound of 40,000 was ~9x the
    // fixture's actual size and could not have caught that regression.
    //
    // This number is sized to the five-item fixture, not the real menu —
    // it will need raising if the fixture grows meaningfully, same as any
    // fixture-shaped assertion.
    expect(digest.length).toBeLessThan(6_000);
  });
});
