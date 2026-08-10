import { describe, it, expect, vi } from "vitest";

// Mock the Square client so catalog.ts doesn't require SQUARE_ACCESS_TOKEN at import time
vi.mock("@/lib/square", () => ({
  squareClient: { catalog: { list: vi.fn() } },
  SQUARE_LOCATION_ID: "test_location",
}));

import { validateProposal, type DrinkProposal } from "@/lib/chat/validate-proposal";
import { fixtureMenu } from "@/lib/chat/__fixtures__/menu";

const menu = fixtureMenu();

function proposal(over: Partial<DrinkProposal> = {}): DrinkProposal {
  return {
    itemId: "ITEM_TARO",
    variationId: "ITEM_TARO_REG",
    modifiers: [
      { modifierId: "MOD_SUGAR_50", count: 1 },
      { modifierId: "MOD_ICE_NONE", count: 1 },
    ],
    quantity: 1,
    reason: "少糖去冰的芋头奶茶",
    ...over,
  };
}

describe("validateProposal — happy path", () => {
  it("accepts a complete proposal and prices it from the catalog", () => {
    const r = validateProposal(menu, proposal());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.unitPriceCents).toBe(750n);
    expect(r.value.totalCents).toBe(750n);
    expect(r.value.categorySlug).toBe("milky");
    expect(r.value.line.variationName).toBe("Regular");
  });

  it("charges modifier upcharges times their count", () => {
    const r = validateProposal(
      menu,
      proposal({
        modifiers: [
          { modifierId: "MOD_SUGAR_50", count: 1 },
          { modifierId: "MOD_ICE_REG", count: 1 },
          { modifierId: "MOD_PEARL", count: 2 },
        ],
        quantity: 2,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.unitPriceCents).toBe(910n);
    expect(r.value.totalCents).toBe(1820n);
  });
});

describe("validateProposal — id integrity", () => {
  it("rejects an unknown itemId", () => {
    const r = validateProposal(menu, proposal({ itemId: "ITEM_NOPE" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/ITEM_NOPE/);
  });

  it("rejects a variation that belongs to a different item", () => {
    const r = validateProposal(menu, proposal({ variationId: "ITEM_MANGO_REG" }));
    expect(r.ok).toBe(false);
  });

  it("rejects a modifier that belongs to no list on this item", () => {
    const r = validateProposal(
      menu,
      proposal({
        modifiers: [
          { modifierId: "MOD_SUGAR_50", count: 1 },
          { modifierId: "MOD_ICE_NONE", count: 1 },
          { modifierId: "MOD_FAKE", count: 1 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/MOD_FAKE/);
  });

  it("rejects a sold-out item", () => {
    const r = validateProposal(
      menu,
      proposal({ itemId: "ITEM_GONE", variationId: "ITEM_GONE_REG" }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/sold out/i);
  });

  it("rejects a sold-out modifier", () => {
    const r = validateProposal(
      menu,
      proposal({
        modifiers: [
          { modifierId: "MOD_SUGAR_50", count: 1 },
          { modifierId: "MOD_ICE_NONE", count: 1 },
          { modifierId: "MOD_SOLDOUT", count: 1 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
  });
});

describe("validateProposal — selection bounds", () => {
  it("rejects when a required list was left unpicked", () => {
    const r = validateProposal(
      menu,
      proposal({ modifiers: [{ modifierId: "MOD_SUGAR_50", count: 1 }] }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/ICE/);
  });

  it("rejects two picks in a pick-exactly-1 list", () => {
    const r = validateProposal(
      menu,
      proposal({
        modifiers: [
          { modifierId: "MOD_SUGAR_50", count: 1 },
          { modifierId: "MOD_SUGAR_0", count: 1 },
          { modifierId: "MOD_ICE_NONE", count: 1 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/SUGAR/);
  });

  it("rejects a 4th distinct topping (maxDistinct = 3)", () => {
    const r = validateProposal(
      menu,
      proposal({
        modifiers: [
          { modifierId: "MOD_SUGAR_50", count: 1 },
          { modifierId: "MOD_ICE_NONE", count: 1 },
          { modifierId: "MOD_PEARL", count: 1 },
          { modifierId: "MOD_JELLY", count: 1 },
          { modifierId: "MOD_PUDDING", count: 1 },
          { modifierId: "MOD_REDBEAN", count: 1 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/different/i);
  });

  it("lets Oreo ride along free of the distinct cap", () => {
    // isUncountedTopping() exempts Oreo, so 3 counted + Oreo is still legal.
    const r = validateProposal(
      menu,
      proposal({
        modifiers: [
          { modifierId: "MOD_SUGAR_50", count: 1 },
          { modifierId: "MOD_ICE_NONE", count: 1 },
          { modifierId: "MOD_PEARL", count: 1 },
          { modifierId: "MOD_JELLY", count: 1 },
          { modifierId: "MOD_PUDDING", count: 1 },
          { modifierId: "MOD_OREO", count: 1 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a 4th of one kind (maxPerKind = 3)", () => {
    const r = validateProposal(
      menu,
      proposal({
        modifiers: [
          { modifierId: "MOD_SUGAR_50", count: 1 },
          { modifierId: "MOD_ICE_NONE", count: 1 },
          { modifierId: "MOD_PEARL", count: 4 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/Pearl/);
  });

  it("rejects a non-positive quantity", () => {
    const r = validateProposal(menu, proposal({ quantity: 0 }));
    expect(r.ok).toBe(false);
  });

  it("caps quantity at 20 so a bad parse can't order 9999 cups", () => {
    const r = validateProposal(menu, proposal({ quantity: 9999 }));
    expect(r.ok).toBe(false);
  });
});

describe("validateProposal — TOP 10 locked toppings", () => {
  function top10Proposal() {
    return proposal({
      itemId: "ITEM_TOP10_TARO",
      variationId: "ITEM_TOP10_TARO_REG",
      modifiers: [
        { modifierId: "MOD_SUGAR_50", count: 1 },
        { modifierId: "MOD_ICE_NONE", count: 1 },
      ],
    });
  }

  it("force-adds the locked topping the model omitted", () => {
    // The TOP 10 preset locks Pudding onto Taro Milk Tea. The customer
    // cannot remove it in the menu UI, so the chatbox must not be able to
    // drop it either — even when the model never mentions it.
    const r = validateProposal(menu, top10Proposal());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.line.modifiers.some((m) => m.id === "MOD_PUDDING")).toBe(true);
  });

  it("charges for the forced topping", () => {
    const r = validateProposal(menu, top10Proposal());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.unitPriceCents).toBe(830n); // 750 base + 80 pudding
  });

  it("uses the preset display name", () => {
    const r = validateProposal(menu, top10Proposal());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.line.itemName).toBe("Taro Milk Tea (with Pudding)");
    expect(r.value.categorySlug).toBe("top-10");
  });

  it("does not double-add a locked topping the model already picked", () => {
    const r = validateProposal(
      menu,
      proposal({
        itemId: "ITEM_TOP10_TARO",
        variationId: "ITEM_TOP10_TARO_REG",
        modifiers: [
          { modifierId: "MOD_SUGAR_50", count: 1 },
          { modifierId: "MOD_ICE_NONE", count: 1 },
          { modifierId: "MOD_PUDDING", count: 1 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.line.modifiers.filter((m) => m.id === "MOD_PUDDING")).toHaveLength(1);
  });

  it("leaves items outside TOP 10 unlocked", () => {
    // Guards against locking every category: plain milky Taro keeps no
    // forced topping and keeps its raw name.
    const r = validateProposal(menu, proposal());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.line.modifiers.some((m) => m.id === "MOD_PUDDING")).toBe(false);
    expect(r.value.line.itemName).toBe("Taro Milk Tea");
  });
});

describe("validateProposal — sold-out variation (partial sell-through)", () => {
  it("rejects a specific sold-out size even when other sizes remain", () => {
    // ITEM_GONE's Regular variation is NOT sold out in the fixture — only
    // Large is. This exercises the variation.soldOut branch specifically:
    // deleting that branch still leaves r.ok === false (the item-level
    // soldOut check also fires for this fixture item), but the message
    // naming the size ("Large") would disappear, which is what this
    // assertion is actually pinned on.
    const r = validateProposal(
      menu,
      proposal({ itemId: "ITEM_GONE", variationId: "ITEM_GONE_LRG" }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/Large/);
  });
});

describe("validateProposal — sold-out locked topping", () => {
  it("rejects a TOP 10 item whose locked topping is sold out, instead of force-adding it silently", () => {
    // Build a locally modified copy of the menu with Pudding sold out —
    // must not mutate the shared fixtureMenu()'s modifierLists Map or its
    // ModifierList/ModifierOption objects, since `menu` above is reused by
    // every other test in this file.
    const base = fixtureMenu();
    const toppingList = base.modifierLists.get("ML_TOPPING")!;
    const modifierLists = new Map(base.modifierLists);
    modifierLists.set("ML_TOPPING", {
      ...toppingList,
      modifiers: toppingList.modifiers.map((m) =>
        m.id === "MOD_PUDDING" ? { ...m, soldOut: true } : m,
      ),
    });
    const menuWithSoldOutPudding = { ...base, modifierLists };

    const r = validateProposal(
      menuWithSoldOutPudding,
      proposal({
        itemId: "ITEM_TOP10_TARO",
        variationId: "ITEM_TOP10_TARO_REG",
        modifiers: [
          { modifierId: "MOD_SUGAR_50", count: 1 },
          { modifierId: "MOD_ICE_NONE", count: 1 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/Pudding/);
    expect(r.errors.join(" ")).toMatch(/sold out/i);
  });

  it("does not affect the shared fixture menu used by other tests", () => {
    // Guards against a regression where the previous test's local copy
    // accidentally mutated shared state: the module-level `menu` must
    // still price Pudding as available.
    const r = validateProposal(
      menu,
      proposal({
        itemId: "ITEM_TOP10_TARO",
        variationId: "ITEM_TOP10_TARO_REG",
        modifiers: [
          { modifierId: "MOD_SUGAR_50", count: 1 },
          { modifierId: "MOD_ICE_NONE", count: 1 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });
});

describe("validateProposal — cross-modifier mutex", () => {
  it("rejects Warm ice combined with Cheese Cream", () => {
    const r = validateProposal(
      menu,
      proposal({
        modifiers: [
          { modifierId: "MOD_SUGAR_50", count: 1 },
          { modifierId: "MOD_ICE_WARM", count: 1 },
          { modifierId: "MOD_CHEESE_CREAM", count: 1 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/warm/i);
  });

  it("rejects Warm ice combined with Brulee", () => {
    const r = validateProposal(
      menu,
      proposal({
        modifiers: [
          { modifierId: "MOD_SUGAR_50", count: 1 },
          { modifierId: "MOD_ICE_WARM", count: 1 },
          { modifierId: "MOD_BRULEE", count: 1 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects Cheese Cream and Brulee selected together", () => {
    const r = validateProposal(
      menu,
      proposal({
        modifiers: [
          { modifierId: "MOD_SUGAR_50", count: 1 },
          { modifierId: "MOD_ICE_NONE", count: 1 },
          { modifierId: "MOD_CHEESE_CREAM", count: 1 },
          { modifierId: "MOD_BRULEE", count: 1 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/Cheese Cream/);
    expect(r.errors.join(" ")).toMatch(/Brulee/);
  });

  it("allows Cheese Cream on its own with regular ice", () => {
    const r = validateProposal(
      menu,
      proposal({
        modifiers: [
          { modifierId: "MOD_SUGAR_50", count: 1 },
          { modifierId: "MOD_ICE_NONE", count: 1 },
          { modifierId: "MOD_CHEESE_CREAM", count: 1 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });
});

describe("validateProposal — Oreo exemption from maxPerKind", () => {
  it("accepts 4 Oreos but still rejects 4 Pearls", () => {
    const rOreo = validateProposal(
      menu,
      proposal({
        modifiers: [
          { modifierId: "MOD_SUGAR_50", count: 1 },
          { modifierId: "MOD_ICE_NONE", count: 1 },
          { modifierId: "MOD_OREO", count: 4 },
        ],
      }),
    );
    expect(rOreo.ok).toBe(true);

    const rPearl = validateProposal(
      menu,
      proposal({
        modifiers: [
          { modifierId: "MOD_SUGAR_50", count: 1 },
          { modifierId: "MOD_ICE_NONE", count: 1 },
          { modifierId: "MOD_PEARL", count: 4 },
        ],
      }),
    );
    expect(rPearl.ok).toBe(false);
  });
});

describe("validateProposal — error accumulation", () => {
  it("reports every problem at once so one retry can fix them all", () => {
    const r = validateProposal(
      menu,
      proposal({
        variationId: "NOPE",
        modifiers: [{ modifierId: "MOD_FAKE", count: 1 }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBeGreaterThan(1);
  });
});
