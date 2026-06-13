// src/lib/tier-group-sync.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  tierGroupIdsFromEnv,
  tierGroupPlan,
  type TierGroupIds,
} from "./tier-group-sync";

const IDS: TierGroupIds = { gold: "GRP_GOLD", diamond: "GRP_DIA" };

describe("tierGroupPlan", () => {
  it("silver (0 pts) with no groups → no ops", () => {
    expect(tierGroupPlan(0, [], IDS)).toEqual({ add: [], remove: [] });
  });

  it("29 pts is still silver", () => {
    expect(tierGroupPlan(29, [], IDS)).toEqual({ add: [], remove: [] });
  });

  it("silver wrongly in gold group → repair removes it", () => {
    expect(tierGroupPlan(0, ["GRP_GOLD"], IDS)).toEqual({
      add: [],
      remove: ["GRP_GOLD"],
    });
  });

  it("30 pts (gold boundary) → add gold", () => {
    expect(tierGroupPlan(30, [], IDS)).toEqual({
      add: ["GRP_GOLD"],
      remove: [],
    });
  });

  it("79 pts is still gold; already in gold group → idempotent no-op", () => {
    expect(tierGroupPlan(79, ["GRP_GOLD"], IDS)).toEqual({
      add: [],
      remove: [],
    });
  });

  it("80 pts (diamond boundary) promoted from gold → add diamond, remove gold", () => {
    expect(tierGroupPlan(80, ["GRP_GOLD"], IDS)).toEqual({
      add: ["GRP_DIA"],
      remove: ["GRP_GOLD"],
    });
  });

  it("diamond already in diamond group → idempotent no-op", () => {
    expect(tierGroupPlan(120, ["GRP_DIA"], IDS)).toEqual({
      add: [],
      remove: [],
    });
  });

  it("ignores unrelated (non-tier) groups", () => {
    expect(tierGroupPlan(30, ["GRP_OTHER"], IDS)).toEqual({
      add: ["GRP_GOLD"],
      remove: [],
    });
  });

  it("repairs a customer wrongly in BOTH tier groups", () => {
    expect(tierGroupPlan(80, ["GRP_GOLD", "GRP_DIA"], IDS)).toEqual({
      add: [],
      remove: ["GRP_GOLD"],
    });
  });
});

describe("tierGroupIdsFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when either env var is missing", () => {
    vi.stubEnv("SQUARE_TIER_GROUP_GOLD_ID", "GRP_GOLD");
    vi.stubEnv("SQUARE_TIER_GROUP_DIAMOND_ID", "");
    expect(tierGroupIdsFromEnv()).toBeNull();
  });

  it("returns both ids when configured", () => {
    vi.stubEnv("SQUARE_TIER_GROUP_GOLD_ID", "GRP_GOLD");
    vi.stubEnv("SQUARE_TIER_GROUP_DIAMOND_ID", "GRP_DIA");
    expect(tierGroupIdsFromEnv()).toEqual(IDS);
  });
});
