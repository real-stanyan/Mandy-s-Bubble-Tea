import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// replaceLine: the checkout page's "Edit" swaps a line for a re-customised
// version of itself. Same localStorage stub as cart-label-selections.test.ts
// so the persist middleware has somewhere to write.

function installLocalStorageMock() {
  let store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: () => null,
    length: 0,
  });
}

beforeEach(() => {
  vi.resetModules();
  installLocalStorageMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const PEARLS = { id: "PEARL", name: "Pearls", priceCents: 80n };
const PUDDING = { id: "PUDDING", name: "Pudding", priceCents: 80n };

function drink(modifiers: { id: string; name: string; priceCents: bigint }[]) {
  return {
    itemId: "ITEM_TARO",
    itemName: "Taro Milk Tea",
    itemImageUrl: null,
    variationId: "VAR1",
    variationName: "Regular",
    variationPriceCents: 750n,
    modifiers,
  };
}

// signatureFor: `${variationId}::${sorted modifier ids}`
const PLAIN_ID = "VAR1::";
const PEARLS_ID = "VAR1::PEARL";
const PUDDING_ID = "VAR1::PUDDING";

async function load() {
  return import("@/store/cart");
}

describe("useCart.replaceLine", () => {
  it("changes the quantity in place when the drink itself is unchanged", async () => {
    const { useCart } = await load();
    const cart = useCart.getState();
    cart.addLine(drink([PEARLS]), 3, { openDrawer: false });
    cart.setLabel(`${PEARLS_ID}:0`, { kind: "preset", hash: "a" });
    cart.setLabel(`${PEARLS_ID}:2`, { kind: "preset", hash: "c" });

    useCart.getState().replaceLine(PEARLS_ID, drink([PEARLS]), 2);

    const s = useCart.getState();
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]).toMatchObject({ id: PEARLS_ID, quantity: 2 });
    // Cup 2 no longer exists; cup 0 keeps its sticker.
    expect(s.labelSelections).toEqual({ [`${PEARLS_ID}:0`]: { kind: "preset", hash: "a" } });
  });

  it("swaps the line where it sits and carries its labels to the new key", async () => {
    const { useCart } = await load();
    const cart = useCart.getState();
    cart.addLine(drink([]), 1, { openDrawer: false });
    cart.addLine(drink([PEARLS]), 2, { openDrawer: false });
    cart.addLine(drink([PUDDING]), 1, { openDrawer: false });
    cart.setLabel(`${PEARLS_ID}:1`, { kind: "preset", hash: "keep" });
    cart.setLabel(`${PUDDING_ID}:0`, { kind: "preset", hash: "other" });

    // Pearls → Pearls + Pudding, still two cups.
    useCart.getState().replaceLine(PEARLS_ID, drink([PEARLS, PUDDING]), 2);

    const s = useCart.getState();
    expect(s.lines.map((l) => l.id)).toEqual([PLAIN_ID, "VAR1::PEARL,PUDDING", PUDDING_ID]);
    expect(s.lines[1].quantity).toBe(2);
    expect(s.labelSelections).toEqual({
      "VAR1::PEARL,PUDDING:1": { kind: "preset", hash: "keep" },
      [`${PUDDING_ID}:0`]: { kind: "preset", hash: "other" },
    });
  });

  it("folds into an identical line already in the cart, labels after its own cups", async () => {
    const { useCart } = await load();
    const cart = useCart.getState();
    cart.addLine(drink([PEARLS]), 1, { openDrawer: false });
    cart.addLine(drink([PUDDING]), 2, { openDrawer: false });
    cart.setLabel(`${PEARLS_ID}:0`, { kind: "preset", hash: "twin-own" });
    cart.setLabel(`${PUDDING_ID}:0`, { kind: "preset", hash: "moved-0" });
    cart.setLabel(`${PUDDING_ID}:1`, { kind: "preset", hash: "moved-1" });

    // The Pudding line is edited into Pearls — which is already in the cart.
    useCart.getState().replaceLine(PUDDING_ID, drink([PEARLS]), 2);

    const s = useCart.getState();
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]).toMatchObject({ id: PEARLS_ID, quantity: 3 });
    expect(s.labelSelections).toEqual({
      [`${PEARLS_ID}:0`]: { kind: "preset", hash: "twin-own" },
      [`${PEARLS_ID}:1`]: { kind: "preset", hash: "moved-0" },
      [`${PEARLS_ID}:2`]: { kind: "preset", hash: "moved-1" },
    });
  });

  it("adds the drink when the edited line has already gone", async () => {
    const { useCart } = await load();
    useCart.getState().addLine(drink([]), 1, { openDrawer: false });

    useCart.getState().replaceLine("VAR1::GONE", drink([PEARLS]), 1);

    const s = useCart.getState();
    expect(s.lines.map((l) => l.id)).toEqual([PLAIN_ID, PEARLS_ID]);
  });

  it("never opens the drawer", async () => {
    const { useCart } = await load();
    useCart.getState().addLine(drink([]), 1, { openDrawer: false });
    useCart.getState().replaceLine(PLAIN_ID, drink([PEARLS]), 1);
    expect(useCart.getState().isOpen).toBe(false);
  });
});
