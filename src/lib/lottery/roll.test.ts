import { describe, expect, it, vi } from "vitest";
import { rollPrize } from "./roll";
import { makeSeededRandom } from "./random";
import type { PrizePool } from "./types";

const POOL: PrizePool = [
  { tier_id: "thank_you", weight: 50, type: "thank_you", payload: {} },
  {
    tier_id: "free_topping",
    weight: 20,
    type: "digital",
    payload: { kind: "free_modifier", modifier_id: "mod_topping_default" },
  },
  {
    tier_id: "discount_3",
    weight: 15,
    type: "digital",
    payload: { kind: "discount", amount_cents: 300 },
  },
  {
    tier_id: "sticker",
    weight: 10,
    type: "physical",
    payload: { label: "Mandy's Sticker" },
  },
  {
    tier_id: "discount_5",
    weight: 4,
    type: "digital",
    payload: { kind: "discount", amount_cents: 500 },
  },
  {
    tier_id: "free_drink",
    weight: 1,
    type: "digital",
    payload: { kind: "free_drink", max_cents: 1000 },
  },
];

const ACTIVE_CAMPAIGN = {
  id: "camp-1",
  name: "Test",
  starts_at: "2026-01-01T00:00:00Z",
  ends_at: "2027-01-01T00:00:00Z",
  prize_pool: POOL,
  is_active: true,
};

interface MockDb {
  campaigns: typeof ACTIVE_CAMPAIGN | null;
  hasPhysicalLock: boolean;
  rolls: Array<unknown>;
  claimCodeExists: boolean;
}

function makeMockDeps(db: MockDb) {
  return {
    getActiveCampaign: vi.fn().mockResolvedValue(db.campaigns),
    userHasPhysicalLock: vi.fn().mockResolvedValue(db.hasPhysicalLock),
    insertRoll: vi.fn().mockImplementation(async (row) => {
      db.rolls.push(row);
      return { ...(row as Record<string, unknown>), id: "roll-uuid-1" };
    }),
    claimCodeExists: vi.fn().mockResolvedValue(db.claimCodeExists),
    rng: makeSeededRandom(42),
  };
}

describe("rollPrize", () => {
  it("returns null for non-app source", async () => {
    const db = { campaigns: ACTIVE_CAMPAIGN, hasPhysicalLock: false, rolls: [], claimCodeExists: false };
    const deps = makeMockDeps(db);
    const result = await rollPrize(
      { userId: "u1", squareOrderId: "sq1", source: "web" },
      deps,
    );
    expect(result).toBeNull();
    expect(deps.getActiveCampaign).not.toHaveBeenCalled();
  });

  it("returns null when no active campaign", async () => {
    const db = { campaigns: null, hasPhysicalLock: false, rolls: [], claimCodeExists: false };
    const deps = makeMockDeps(db);
    const result = await rollPrize(
      { userId: "u1", squareOrderId: "sq1", source: "app" },
      deps,
    );
    expect(result).toBeNull();
    expect(deps.insertRoll).not.toHaveBeenCalled();
  });

  it("returns a non-physical tier when user has physical lock", async () => {
    const db = { campaigns: ACTIVE_CAMPAIGN, hasPhysicalLock: true, rolls: [], claimCodeExists: false };
    const deps = makeMockDeps(db);
    for (let i = 0; i < 50; i++) {
      const result = await rollPrize(
        { userId: "u1", squareOrderId: `sq-${i}`, source: "app" },
        { ...deps, rng: makeSeededRandom(i + 1) },
      );
      expect(result?.prize_type).not.toBe("physical");
    }
  });

  it("inserts a roll row with status=won_active and correct expires_at", async () => {
    const db = { campaigns: ACTIVE_CAMPAIGN, hasPhysicalLock: false, rolls: [], claimCodeExists: false };
    const deps = makeMockDeps(db);
    await rollPrize(
      { userId: "u1", squareOrderId: "sq1", source: "app" },
      deps,
    );
    expect(deps.insertRoll).toHaveBeenCalledTimes(1);
    const inserted = (deps.insertRoll.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(inserted.status).toBe("won_active");
    expect(inserted.user_id).toBe("u1");
    expect(inserted.square_order_id).toBe("sq1");
    expect(inserted.campaign_id).toBe("camp-1");
  });

  it("generates claim_code only for physical prizes", async () => {
    const physicalOnlyPool: PrizePool = [
      { tier_id: "sticker", weight: 100, type: "physical", payload: { label: "Sticker" } },
    ];
    const db = {
      campaigns: { ...ACTIVE_CAMPAIGN, prize_pool: physicalOnlyPool },
      hasPhysicalLock: false,
      rolls: [],
      claimCodeExists: false,
    };
    const deps = makeMockDeps(db);
    const result = await rollPrize(
      { userId: "u1", squareOrderId: "sq1", source: "app" },
      deps,
    );
    expect(result?.prize_type).toBe("physical");
    expect(result?.claim_code).toBeDefined();
    expect(result?.claim_code).toHaveLength(6);
  });

  it("does not generate claim_code for thank_you or digital prizes", async () => {
    const digitalOnlyPool: PrizePool = [
      {
        tier_id: "discount_3",
        weight: 100,
        type: "digital",
        payload: { kind: "discount", amount_cents: 300 },
      },
    ];
    const db = {
      campaigns: { ...ACTIVE_CAMPAIGN, prize_pool: digitalOnlyPool },
      hasPhysicalLock: false,
      rolls: [],
      claimCodeExists: false,
    };
    const deps = makeMockDeps(db);
    const result = await rollPrize(
      { userId: "u1", squareOrderId: "sq1", source: "app" },
      deps,
    );
    expect(result?.claim_code).toBeUndefined();
  });

  it("sets expires_at = +30d for digital, +7d for physical, null for thank_you", async () => {
    const cases: Array<["digital" | "physical" | "thank_you", number | null]> = [
      ["digital", 30],
      ["physical", 7],
      ["thank_you", null],
    ];
    for (const [type, daysExpected] of cases) {
      const pool: PrizePool = [
        type === "thank_you"
          ? { tier_id: "thank_you", weight: 100, type, payload: {} }
          : type === "digital"
          ? {
              tier_id: "discount",
              weight: 100,
              type,
              payload: { kind: "discount", amount_cents: 300 },
            }
          : { tier_id: "sticker", weight: 100, type, payload: { label: "Sticker" } },
      ];
      const db = {
        campaigns: { ...ACTIVE_CAMPAIGN, prize_pool: pool },
        hasPhysicalLock: false,
        rolls: [],
        claimCodeExists: false,
      };
      const deps = makeMockDeps(db);
      const before = Date.now();
      await rollPrize(
        { userId: "u1", squareOrderId: `sq-${type}`, source: "app" },
        deps,
      );
      const after = Date.now();
      const inserted = (deps.insertRoll.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
      const expiresAt = inserted.expires_at as string | null;
      if (daysExpected === null) {
        expect(expiresAt).toBeNull();
      } else {
        const ms = new Date(expiresAt as string).getTime();
        expect(ms).toBeGreaterThanOrEqual(before + daysExpected * 86_400_000 - 1000);
        expect(ms).toBeLessThanOrEqual(after + daysExpected * 86_400_000 + 1000);
      }
    }
  });
});
