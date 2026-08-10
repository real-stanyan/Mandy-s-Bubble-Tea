import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  proposalToCartLine,
  toApiProposal,
  type ApiProposal,
} from "@/lib/chat/proposal-to-cart";
import { buildCartLine } from "@/lib/menu/build-cart-line";
import type { CountMap } from "@/lib/menu/build-cart-line";
import type { MenuItem, ItemVariation, ModifierList } from "@/lib/catalog";
import type { ValidatedProposal } from "@/lib/chat/validate-proposal";

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

// ---------------------------------------------------------------------------
// Round trip: buildCartLine() (menu path) -> toApiProposal() (server
// serialize) -> proposalToCartLine() (client rehydrate) -> addLine() must
// merge with a line addLine()'d straight from buildCartLine()'s own output.
// This is the feature's actual safety property: the two id-fixed unit tests
// above prove proposalToCartLine's *output shape*, but nothing before this
// test exercised the real round trip end to end, and both TEST NAMES above
// ("matching buildCartLine's count expansion", "so signatureFor stays
// stable") were promises this file didn't keep. If toApiProposal or
// proposalToCartLine ever drop, reorder, or re-key a modifier, this is what
// catches it — not a manual click-through.

const localStorageStore: Record<string, string> = {};

function installLocalStorageMock() {
  for (const k of Object.keys(localStorageStore)) delete localStorageStore[k];
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => localStorageStore[key] ?? null,
    setItem: (key: string, value: string) => {
      localStorageStore[key] = value;
    },
    removeItem: (key: string) => {
      delete localStorageStore[key];
    },
    clear: () => {
      for (const k of Object.keys(localStorageStore)) delete localStorageStore[k];
    },
    key: () => null,
    length: 0,
  });
}

describe("round trip through toApiProposal", () => {
  beforeEach(() => {
    vi.resetModules();
    installLocalStorageMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("addLine()-ing the original buildCartLine() output and the round-tripped proposal merges into one row, qty 2", async () => {
    const { useCart } = await import("@/store/cart");

    const item: MenuItem = {
      id: "ITEM_TARO",
      name: "Taro Milk Tea",
      description: null,
      imageUrl: "https://example.test/taro.png",
      priceCents: 750n,
      variationLabel: "Regular",
      variations: [],
      modifierListRefs: [],
      categoryIds: ["milky"],
      soldOut: false,
    };
    const variation: ItemVariation = {
      id: "ITEM_TARO_REG",
      name: "Regular",
      priceCents: 750n,
      soldOut: false,
    };
    const modifierLists: ModifierList[] = [
      {
        id: "ML_TOPPING",
        name: "TOPPING",
        minSelected: 0,
        maxSelected: null,
        maxDistinct: null,
        maxPerKind: null,
        modifiers: [
          {
            id: "MOD_PEARL",
            name: "Pearl",
            priceCents: 80n,
            ordinal: 0,
            onByDefault: false,
            soldOut: false,
          },
        ],
      },
    ];
    // Pearl picked twice — the exact shape that broke the naive collapsed
    // (non-expanding) version of this converter.
    const counts: CountMap = { ML_TOPPING: { MOD_PEARL: 2 } };

    const originalLine = buildCartLine({ item, variation, modifierLists, counts });

    const validated: ValidatedProposal = {
      line: originalLine,
      quantity: 1,
      unitPriceCents: 750n + 80n + 80n,
      totalCents: 750n + 80n + 80n,
      categorySlug: "milky",
      reason: "test fixture",
    };

    const roundTripped = proposalToCartLine(toApiProposal(validated));

    useCart.getState().addLine(originalLine, 1);
    useCart.getState().addLine(roundTripped, 1);

    const lines = useCart.getState().lines;
    expect(lines.length).toBe(1);
    expect(lines[0].quantity).toBe(2);
  });
});
