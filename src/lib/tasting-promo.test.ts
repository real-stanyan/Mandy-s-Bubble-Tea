import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase-server module before importing the SUT.
vi.mock("./supabase-server", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "./supabase-server";
import {
  claimTastingPromoPush,
  getActiveTastingPromo,
  getTastingPromoByKey,
  tastingDiscountFor,
  tastingPromoCopy,
  tastingPromoUid,
  TASTING_CUPS_PER_ORDER,
  type TastingCup,
} from "./tasting-promo";

const mockedAdmin = vi.mocked(getSupabaseAdmin);

const NOW = new Date("2026-08-07T05:00:00Z");

/** `.from(t).select().eq().lte().gt().order().limit().maybeSingle()` chain. */
function buildSelectAdmin(result: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ["eq", "lte", "gt", "order", "limit", "is"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  const from = vi.fn(() => ({ select: vi.fn(() => chain) }));
  return { from } as unknown as ReturnType<typeof getSupabaseAdmin>;
}

/** `.from(t).update().eq().is().select()` — the conditional push claim. */
function buildUpdateAdmin(result: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.select = vi.fn().mockResolvedValue(result);
  const from = vi.fn(() => ({ update: vi.fn(() => chain) }));
  return { from } as unknown as ReturnType<typeof getSupabaseAdmin>;
}

const ACTIVE_ROW = {
  key: "strawberry-matcha-2026-08",
  product_name: "Strawberry Matcha Milk Tea",
  tasting_price_cents: 500,
  ends_at: "2026-08-12T05:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getActiveTastingPromo", () => {
  it("returns the open promo", async () => {
    mockedAdmin.mockReturnValue(
      buildSelectAdmin({ data: ACTIVE_ROW, error: null }),
    );
    await expect(getActiveTastingPromo(NOW)).resolves.toEqual({
      available: true,
      key: "strawberry-matcha-2026-08",
      productName: "Strawberry Matcha Milk Tea",
      tastingPriceCents: 500,
      endsAt: "2026-08-12T05:00:00Z",
    });
  });

  it("is disabled when no row matches the window", async () => {
    mockedAdmin.mockReturnValue(buildSelectAdmin({ data: null, error: null }));
    const status = await getActiveTastingPromo(NOW);
    expect(status.available).toBe(false);
    expect(status.tastingPriceCents).toBe(0);
  });

  it("swallows a lookup failure — a status hiccup must not block checkout", async () => {
    mockedAdmin.mockReturnValue(
      buildSelectAdmin({ data: null, error: { message: "boom" } }),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getActiveTastingPromo(NOW)).resolves.toMatchObject({
      available: false,
    });
    spy.mockRestore();
  });

  it("filters on the window server-side, not in JS", async () => {
    const admin = buildSelectAdmin({ data: null, error: null });
    mockedAdmin.mockReturnValue(admin);
    await getActiveTastingPromo(NOW);
    const chain = (
      admin.from as unknown as ReturnType<typeof vi.fn>
    ).mock.results[0].value.select.mock.results[0].value;
    expect(chain.lte).toHaveBeenCalledWith("starts_at", NOW.toISOString());
    expect(chain.gt).toHaveBeenCalledWith("ends_at", NOW.toISOString());
  });
});

describe("getTastingPromoByKey", () => {
  it("throws rather than failing safe — an admin deserves the real error", async () => {
    mockedAdmin.mockReturnValue(
      buildSelectAdmin({ data: null, error: { message: "no table" } }),
    );
    await expect(getTastingPromoByKey("k")).rejects.toThrow(/no table/);
  });

  it("returns null when the key does not exist", async () => {
    mockedAdmin.mockReturnValue(buildSelectAdmin({ data: null, error: null }));
    await expect(getTastingPromoByKey("k")).resolves.toBeNull();
  });
});

describe("claimTastingPromoPush", () => {
  it("wins when the conditional update matched a row", async () => {
    mockedAdmin.mockReturnValue(
      buildUpdateAdmin({ data: [{ key: "k" }], error: null }),
    );
    await expect(claimTastingPromoPush("k")).resolves.toBe(true);
  });

  it("loses when pushed_at was already stamped", async () => {
    mockedAdmin.mockReturnValue(buildUpdateAdmin({ data: [], error: null }));
    await expect(claimTastingPromoPush("k")).resolves.toBe(false);
  });
});

describe("tastingPromoUid", () => {
  it("uses a dot separator — a colon 400-rejects at Square", () => {
    expect(tastingPromoUid("strawberry-matcha-2026-08")).toBe(
      "tasting-promo.strawberry-matcha-2026-08",
    );
    expect(tastingPromoUid("k")).not.toContain(":");
  });
});

describe("tastingPromoCopy", () => {
  it("states the row's price and the whole days left", () => {
    const copy = tastingPromoCopy(
      {
        productName: "Strawberry Matcha Milk Tea",
        tastingPriceCents: 500,
        endsAt: "2026-08-12T05:00:00Z",
      },
      NOW,
    );
    expect(copy.title).toBe("🧋 New Taste — Strawberry Matcha Milk Tea");
    expect(copy.body).toContain("$5.00");
    expect(copy.body).toContain("Valid 5 days");
  });

  it("never says 0 days while the promo is still live", () => {
    const copy = tastingPromoCopy(
      {
        productName: "X",
        tastingPriceCents: 500,
        endsAt: "2026-08-07T06:00:00Z",
      },
      NOW,
    );
    expect(copy.body).toContain("Valid 1 day.");
  });
});

describe("tastingDiscountFor", () => {
  const cup = (name: string, base: bigint, mods = 0n): TastingCup => ({
    itemName: name,
    basePriceCents: base,
    unitPriceCents: base + mods,
  });

  const PRODUCT = "Strawberry Matcha Milk Tea";

  it("discounts the matching cup down to the tasting price", () => {
    expect(
      tastingDiscountFor({
        cups: [cup(PRODUCT, 850n)],
        productName: PRODUCT,
        tastingPriceCents: 500,
      }),
    ).toEqual({ amountCents: 350n, cupsCovered: 1 });
  });

  it("prices off the drink alone — toppings are not part of the tasting price", () => {
    // $8.50 drink + $1.20 pearls: the saving is still 850 - 500, so the cup
    // costs $5.00 + $1.20, not $5.00 flat.
    expect(
      tastingDiscountFor({
        cups: [cup(PRODUCT, 850n, 120n)],
        productName: PRODUCT,
        tastingPriceCents: 500,
      }).amountCents,
    ).toBe(350n);
  });

  it("covers one cup per order, the most expensive one", () => {
    expect(TASTING_CUPS_PER_ORDER).toBe(1);
    const result = tastingDiscountFor({
      cups: [cup(PRODUCT, 700n), cup(PRODUCT, 900n), cup(PRODUCT, 850n)],
      productName: PRODUCT,
      tastingPriceCents: 500,
    });
    expect(result).toEqual({ amountCents: 400n, cupsCovered: 1 });
  });

  it("ignores cups of other drinks", () => {
    expect(
      tastingDiscountFor({
        cups: [cup("Taro Milk Tea", 900n), cup("Brown Sugar Boba", 800n)],
        productName: PRODUCT,
        tastingPriceCents: 500,
      }),
    ).toEqual({ amountCents: 0n, cupsCovered: 0 });
  });

  it("matches the catalog name case- and whitespace-insensitively", () => {
    expect(
      tastingDiscountFor({
        cups: [cup("strawberry  MATCHA milk tea ", 850n)],
        productName: PRODUCT,
        tastingPriceCents: 500,
      }).cupsCovered,
    ).toBe(1);
  });

  it("never pays out when the cup already costs less than the tasting price", () => {
    expect(
      tastingDiscountFor({
        cups: [cup(PRODUCT, 450n)],
        productName: PRODUCT,
        tastingPriceCents: 500,
      }),
    ).toEqual({ amountCents: 0n, cupsCovered: 0 });
  });

  it("excludes the cups a loyalty reward already makes free", () => {
    // Cheapest cup is the reward cup. Only the $9.00 cup is left to discount.
    const result = tastingDiscountFor({
      cups: [cup(PRODUCT, 700n), cup(PRODUCT, 900n)],
      productName: PRODUCT,
      tastingPriceCents: 500,
      rewardCupCount: 1,
    });
    expect(result).toEqual({ amountCents: 400n, cupsCovered: 1 });
  });

  it("pays nothing when the reward covers every matching cup", () => {
    expect(
      tastingDiscountFor({
        cups: [cup(PRODUCT, 700n)],
        productName: PRODUCT,
        tastingPriceCents: 500,
        rewardCupCount: 1,
      }),
    ).toEqual({ amountCents: 0n, cupsCovered: 0 });
  });

  it("is inert when the promo names nothing", () => {
    expect(
      tastingDiscountFor({
        cups: [cup(PRODUCT, 850n)],
        productName: "   ",
        tastingPriceCents: 500,
      }),
    ).toEqual({ amountCents: 0n, cupsCovered: 0 });
  });

  it("prices an unknown-variation cup (empty name, 0) at nothing", () => {
    expect(
      tastingDiscountFor({
        cups: [cup("", 0n)],
        productName: PRODUCT,
        tastingPriceCents: 500,
      }),
    ).toEqual({ amountCents: 0n, cupsCovered: 0 });
  });
});
