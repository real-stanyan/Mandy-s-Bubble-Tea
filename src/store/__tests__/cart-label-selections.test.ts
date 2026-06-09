import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let setItemSpy: ReturnType<typeof vi.fn>;
let store: Record<string, string>;

function installLocalStorageMock(seed: Record<string, string> = {}) {
  store = { ...seed };
  setItemSpy = vi.fn((key: string, value: string) => {
    store[key] = value;
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: setItemSpy,
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

describe("cart labelSelections union", () => {
  it("setLabel accepts kind:preset", async () => {
    const { useCart, cupKey } = await import("@/store/cart");
    const key = cupKey("VAR123::MOD1,MOD2", 0);
    useCart.getState().setLabel(key, { kind: "preset", hash: "abc123" });
    const sel = useCart.getState().labelSelections[key];
    expect(sel).toEqual({ kind: "preset", hash: "abc123" });
  });

  it("setLabel accepts kind:photo", async () => {
    const { useCart, cupKey } = await import("@/store/cart");
    const key = cupKey("VAR123::", 0);
    useCart.getState().setLabel(key, {
      kind: "photo",
      uploadedDoodleId: "00000000-0000-0000-0000-000000000001",
      previewUrl: "https://example/preview.png",
    });
    expect(useCart.getState().labelSelections[key]).toMatchObject({
      kind: "photo",
      uploadedDoodleId: "00000000-0000-0000-0000-000000000001",
    });
  });

  it("setLabel accepts kind:ai", async () => {
    const { useCart, cupKey } = await import("@/store/cart");
    const key = cupKey("VAR123::", 0);
    useCart.getState().setLabel(key, {
      kind: "ai",
      aiDoodleId: "00000000-0000-0000-0000-000000000002",
      prompt: "cats reading on a moon",
    });
    expect(useCart.getState().labelSelections[key]).toMatchObject({
      kind: "ai",
      prompt: "cats reading on a moon",
    });
  });

  it("clear() regenerates cartSessionId and empties labelSelections", async () => {
    const { useCart } = await import("@/store/cart");
    const before = useCart.getState().cartSessionId;
    expect(before).toMatch(/^[0-9a-f-]{36}$/i);
    useCart.getState().setLabel("k:0", { kind: "preset", hash: "x" });
    useCart.getState().clear();
    const after = useCart.getState().cartSessionId;
    expect(after).toMatch(/^[0-9a-f-]{36}$/i);
    expect(after).not.toBe(before);
    expect(useCart.getState().labelSelections).toEqual({});
  });

  it("persist v0 → v1 migration drops legacy hash-string entries", async () => {
    installLocalStorageMock({
      "mandy-cart": JSON.stringify({
        state: {
          lines: [],
          labelSelections: { "VAR::": "abc123" },
        },
        version: 0,
      }),
    });
    const { useCart } = await import("@/store/cart");
    useCart.persist.rehydrate();
    const s = useCart.getState();
    expect(s.labelSelections).toEqual({});
    expect(s.cartSessionId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("prune helpers strip selections by single-colon prefix", async () => {
    const { useCart } = await import("@/store/cart");
    useCart.getState().setLabel("LINE_A:0", { kind: "preset", hash: "a" });
    useCart.getState().setLabel("LINE_A:1", { kind: "preset", hash: "b" });
    useCart.getState().setLabel("LINE_B:0", { kind: "preset", hash: "c" });
    useCart.setState((s) => ({
      lines: [
        ...s.lines,
        {
          id: "LINE_A",
          itemId: "X",
          itemName: "x",
          itemImageUrl: null,
          variationId: "V",
          variationName: "v",
          variationPriceCents: 0n,
          modifiers: [],
          quantity: 1,
        },
      ],
    }));
    useCart.getState().setQuantity("LINE_A", 0);
    expect(useCart.getState().labelSelections).toEqual({
      "LINE_B:0": { kind: "preset", hash: "c" },
    });
  });
});

describe("cart keepLabelCopy", () => {
  it("defaults to false and toggles via setKeepLabelCopy", async () => {
    const { useCart } = await import("@/store/cart");
    expect(useCart.getState().keepLabelCopy).toBe(false);
    useCart.getState().setKeepLabelCopy(true);
    expect(useCart.getState().keepLabelCopy).toBe(true);
  });

  it("clear() resets keepLabelCopy to false", async () => {
    const { useCart } = await import("@/store/cart");
    useCart.getState().setKeepLabelCopy(true);
    useCart.getState().clear();
    expect(useCart.getState().keepLabelCopy).toBe(false);
  });
});
