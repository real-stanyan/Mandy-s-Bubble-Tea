import { describe, it, expect } from "vitest";
import {
  buildSoldOutIndex,
  scanSoldOut,
  soldOutMessage,
  type SoldOutIndex,
} from "./sold-out";
import type { Menu } from "./catalog";

function menu(): Menu {
  const item = (
    name: string,
    variations: { id: string; name: string; soldOut: boolean }[],
  ) =>
    ({
      id: `item-${name}`,
      name,
      description: null,
      imageUrl: null,
      priceCents: 600n,
      variationLabel: null,
      variations: variations.map((v) => ({ ...v, priceCents: 600n })),
      modifierListRefs: [],
      categoryIds: [],
      soldOut: variations.every((v) => v.soldOut),
    }) as unknown as Menu["uncategorizedItems"][number];

  return {
    categories: [],
    itemsBySlug: new Map([
      [
        "milky",
        [
          item("Taro Milk Tea", [
            { id: "V_TARO_R", name: "Regular", soldOut: false },
            { id: "V_TARO_L", name: "Large", soldOut: true },
          ]),
        ],
      ],
    ]),
    uncategorizedItems: [
      item("Staff Drink", [{ id: "V_STAFF", name: "", soldOut: true }]),
    ],
    modifierLists: new Map([
      [
        "ML_TOPPINGS",
        {
          id: "ML_TOPPINGS",
          name: "Toppings",
          modifiers: [
            { id: "M_PEARLS", name: "Pearls", soldOut: false },
            { id: "M_PUDDING", name: "Pudding", soldOut: true },
          ],
        },
      ],
    ]) as unknown as Menu["modifierLists"],
  } as unknown as Menu;
}

const index = (): SoldOutIndex => buildSoldOutIndex(menu());

describe("buildSoldOutIndex", () => {
  it("indexes only what is sold out — a miss must mean nothing, not unknown", () => {
    const i = index();
    expect(i.variations.has("V_TARO_L")).toBe(true);
    expect(i.variations.has("V_TARO_R")).toBe(false);
    expect(i.modifiers.has("M_PUDDING")).toBe(true);
    expect(i.modifiers.has("M_PEARLS")).toBe(false);
  });

  it("labels a variation with its item name so the customer recognises it", () => {
    expect(index().variations.get("V_TARO_L")).toBe("Taro Milk Tea (Large)");
  });

  it("covers uncategorized items too — they are orderable and can sell out", () => {
    expect(index().variations.get("V_STAFF")).toBe("Staff Drink");
  });
});

describe("scanSoldOut", () => {
  it("passes a cart the catalog is happy to sell", () => {
    expect(
      scanSoldOut(
        [{ variationId: "V_TARO_R", modifiers: [{ id: "M_PEARLS" }] }],
        index(),
      ),
    ).toEqual({ names: [], lineIndexes: [] });
  });

  it("catches a sold-out topping on an otherwise fine drink", () => {
    // The #101 case: the drink is available, the locked topping isn't.
    expect(
      scanSoldOut(
        [{ variationId: "V_TARO_R", modifiers: [{ id: "M_PUDDING" }] }],
        index(),
      ),
    ).toEqual({ names: ["Pudding"], lineIndexes: [0] });
  });

  it("reports which line is at fault, not just that something is", () => {
    const scan = scanSoldOut(
      [
        { variationId: "V_TARO_R", modifiers: [] },
        { variationId: "V_TARO_R", modifiers: [{ id: "M_PUDDING" }] },
        { variationId: "V_TARO_R", modifiers: [] },
      ],
      index(),
    );
    expect(scan.lineIndexes).toEqual([1]);
  });

  it("counts a line once even when its drink AND its topping are both out", () => {
    const scan = scanSoldOut(
      [{ variationId: "V_TARO_L", modifiers: [{ id: "M_PUDDING" }] }],
      index(),
    );
    expect(scan.lineIndexes).toEqual([0]);
    expect(scan.names).toEqual(["Taro Milk Tea (Large)", "Pudding"]);
  });

  it("dedupes a name repeated across lines but keeps both line numbers", () => {
    const scan = scanSoldOut(
      [
        { variationId: "V_TARO_R", modifiers: [{ id: "M_PUDDING" }] },
        { variationId: "V_TARO_R", modifiers: [{ id: "M_PUDDING" }] },
      ],
      index(),
    );
    expect(scan.names).toEqual(["Pudding"]);
    expect(scan.lineIndexes).toEqual([0, 1]);
  });

  it("says nothing about a line the catalog has never heard of — that's a stale cart, not sold out", () => {
    expect(
      scanSoldOut([{ variationId: "V_GONE", modifiers: [] }], index()),
    ).toEqual({ names: [], lineIndexes: [] });
  });
});

describe("soldOutMessage", () => {
  // "Please refresh the menu" was the old ending and fixed nothing: the cart is
  // persisted, so a fresh menu leaves the same dead line sitting in it.
  it("tells the customer to remove the drink, not to refresh", () => {
    const msg = soldOutMessage(["Pudding"]);
    expect(msg).toContain("Remove that drink from your cart");
    expect(msg.toLowerCase()).not.toContain("refresh");
  });

  it("switches to plural without reading like a template", () => {
    expect(soldOutMessage(["Pudding", "Pearls"])).toBe(
      "These just sold out: Pudding, Pearls. Remove those drinks from your cart and the rest of your order is fine.",
    );
  });
});
