import { describe, it, expect } from "vitest";
import { pickPromoCups } from "./promo-cup-pick";

describe("pickPromoCups", () => {
  it("welcome wins when both promos are available; IG empty (caller MUST not consume IG ticket)", () => {
    const result = pickPromoCups({
      unitPrices: [1000n, 800n, 600n], // unsorted on input
      welcomeK: 2,
      igFollowK: 1,
    });
    expect(result.welcomeCups).toEqual([600n, 800n]);
    expect(result.igFollowCups).toEqual([]);
  });

  it("welcome only — IG empty when igFollowK is 0", () => {
    const result = pickPromoCups({
      unitPrices: [600n, 1000n],
      welcomeK: 2,
      igFollowK: 0,
    });
    expect(result.welcomeCups).toEqual([600n, 1000n]);
    expect(result.igFollowCups).toEqual([]);
  });

  it("IG only — welcome empty when welcomeK is 0", () => {
    const result = pickPromoCups({
      unitPrices: [600n, 1000n],
      welcomeK: 0,
      igFollowK: 1,
    });
    expect(result.welcomeCups).toEqual([]);
    expect(result.igFollowCups).toEqual([600n]);
  });

  it("one-cup welcome-priority rule still holds: welcome takes the cup, IG empty", () => {
    const result = pickPromoCups({
      unitPrices: [800n],
      welcomeK: 1,
      igFollowK: 1,
    });
    expect(result.welcomeCups).toEqual([800n]);
    expect(result.igFollowCups).toEqual([]);
  });

  it("clamps welcomeK to available cup count", () => {
    const result = pickPromoCups({
      unitPrices: [600n],
      welcomeK: 2,
      igFollowK: 0,
    });
    expect(result.welcomeCups).toEqual([600n]);
    expect(result.igFollowCups).toEqual([]);
  });

  it("clamps igFollowK to available cup count when only IG is available", () => {
    const result = pickPromoCups({
      unitPrices: [600n],
      welcomeK: 0,
      igFollowK: 2,
    });
    expect(result.welcomeCups).toEqual([]);
    expect(result.igFollowCups).toEqual([600n]);
  });

  it("welcome covers cheapest K only; remaining cups stay regular even with IG ticket on file", () => {
    const result = pickPromoCups({
      unitPrices: [600n, 800n, 1000n],
      welcomeK: 1,
      igFollowK: 1,
    });
    expect(result.welcomeCups).toEqual([600n]);
    expect(result.igFollowCups).toEqual([]);
  });

  it("returns empty arrays when unitPrices is empty", () => {
    const result = pickPromoCups({
      unitPrices: [],
      welcomeK: 2,
      igFollowK: 1,
    });
    expect(result.welcomeCups).toEqual([]);
    expect(result.igFollowCups).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [1000n, 600n, 800n];
    pickPromoCups({ unitPrices: input, welcomeK: 1, igFollowK: 1 });
    expect(input).toEqual([1000n, 600n, 800n]);
  });
});
