import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/square", () => ({
  squareClient: { catalog: { list: vi.fn() } },
  SQUARE_LOCATION_ID: "test_location",
}));

import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import { fixtureMenu } from "@/lib/chat/__fixtures__/menu";
import type { Promotion } from "@/lib/chat/promotions";

/** The digest's own header — the rules text mentions "LIVE PROMOTIONS" too,
 *  so anchoring on the bare phrase finds the wrong occurrence. */
const PROMO_BLOCK = "LIVE PROMOTIONS (these are the ONLY promotions";

const PERSONAL: Promotion[] = [
  {
    key: "loyalty",
    title: "你有 2 杯免费饮品",
    detail: "你现在有 18 颗星。",
    promptDetail: "They have 18 stars and can redeem 2 free drinks.",
    href: "/account/promotions",
    cta: "去兑换",
  },
];

describe("buildSystemPrompt — prompt cache prefix", () => {
  it("keeps per-customer content BELOW the menu", () => {
    // DeepSeek caches on a stable prefix and the menu is the largest block,
    // so anything that differs between customers must come after it.
    // Shipped above the menu on 2026-08-12, the promotions block (which
    // carries the reader's own star balance) took a second customer from
    // cache_hit=2560 to cache_hit=0 — the whole menu re-prefilled at full
    // price on every single turn.
    const prompt = buildSystemPrompt(fixtureMenu(), null, PERSONAL);
    const menuAt = prompt.indexOf("\nMENU\n");
    const promoAt = prompt.indexOf(PROMO_BLOCK);
    expect(menuAt).toBeGreaterThan(-1);
    expect(promoAt).toBeGreaterThan(menuAt);
  });

  it("gives two customers an identical prefix up to the end of the menu", () => {
    const a = buildSystemPrompt(fixtureMenu(), null, PERSONAL);
    const b = buildSystemPrompt(fixtureMenu(), null, [
      { ...PERSONAL[0], title: "你有 5 杯免费饮品", detail: "你现在有 45 颗星。" },
    ]);
    // Everything before LIVE PROMOTIONS must be byte-identical — that span
    // is what the provider can cache.
    const prefixA = a.slice(0, a.indexOf(PROMO_BLOCK));
    const prefixB = b.slice(0, b.indexOf(PROMO_BLOCK));
    expect(prefixA).toBe(prefixB);
    expect(prefixA.length).toBeGreaterThan(500); // the menu really is in there
  });

  it("still carries the promotions the model is allowed to speak about", () => {
    const prompt = buildSystemPrompt(fixtureMenu(), null, PERSONAL);
    expect(prompt).toContain("[loyalty]");
    // The model reads promptDetail, never the card's Chinese copy — this
    // used to assert the opposite, which is how the language bug shipped.
    // See promotions-language.test.ts for the gate.
    expect(prompt).toContain("They have 18 stars");
    expect(prompt).not.toContain("你有 2 杯免费饮品");
  });
});
