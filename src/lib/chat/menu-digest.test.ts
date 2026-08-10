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
    expect(digest.length).toBeLessThan(40_000);
  });
});
