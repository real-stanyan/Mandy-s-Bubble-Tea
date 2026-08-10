import { describe, it, expect } from "vitest";
import { proposalToCartLine, type ApiProposal } from "@/lib/chat/proposal-to-cart";

const apiProposal: ApiProposal = {
  itemId: "ITEM_TARO",
  itemName: "Taro Milk Tea",
  imageUrl: "https://example.test/taro.png",
  categorySlug: "milky",
  variationId: "ITEM_TARO_REG",
  variationName: "Regular",
  variationPriceCents: "750",
  modifiers: [
    { id: "MOD_SUGAR_50", name: "50%", priceCents: "0" },
    { id: "MOD_PEARL", name: "Pearl", priceCents: "80" },
  ],
  quantity: 2,
  unitPriceCents: "830",
  totalCents: "1660",
  reason: "半糖芋头奶茶加珍珠",
};

describe("proposalToCartLine", () => {
  it("rehydrates every amount into BigInt cents", () => {
    const line = proposalToCartLine(apiProposal);
    expect(line.variationPriceCents).toBe(750n);
    expect(line.modifiers.map((m) => m.priceCents)).toEqual([0n, 80n]);
  });

  it("carries names and ids through unchanged", () => {
    const line = proposalToCartLine(apiProposal);
    expect(line.itemId).toBe("ITEM_TARO");
    expect(line.itemName).toBe("Taro Milk Tea");
    expect(line.itemImageUrl).toBe("https://example.test/taro.png");
    expect(line.variationId).toBe("ITEM_TARO_REG");
    expect(line.variationName).toBe("Regular");
  });

  it("preserves modifier order so signatureFor stays stable", () => {
    expect(proposalToCartLine(apiProposal).modifiers.map((m) => m.id)).toEqual([
      "MOD_SUGAR_50",
      "MOD_PEARL",
    ]);
  });

  it("tolerates a null image", () => {
    expect(proposalToCartLine({ ...apiProposal, imageUrl: null }).itemImageUrl).toBeNull();
  });

  it("repeats a modifier picked multiple times, matching buildCartLine's count expansion", () => {
    const withRepeat: ApiProposal = {
      ...apiProposal,
      modifiers: [
        { id: "MOD_PEARL", name: "Pearl", priceCents: "80" },
        { id: "MOD_PEARL", name: "Pearl", priceCents: "80" },
      ],
    };
    const line = proposalToCartLine(withRepeat);
    expect(line.modifiers.map((m) => m.id)).toEqual(["MOD_PEARL", "MOD_PEARL"]);
    expect(line.modifiers.map((m) => m.priceCents)).toEqual([80n, 80n]);
  });
});
