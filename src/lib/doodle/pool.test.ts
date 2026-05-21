import { describe, it, expect } from "vitest";
import { POOL, pickDefaultForCup, hashSeed } from "./pool";

describe("default doodle pool", () => {
  it("has at least 4 entries", () => {
    expect(POOL.length).toBeGreaterThanOrEqual(4);
  });

  it("every entry has key + svg", () => {
    for (const item of POOL) {
      expect(item.key).toMatch(/^[a-z][a-z0-9_-]*$/);
      expect(item.svg.startsWith("<svg")).toBe(true);
    }
  });

  it("pickDefaultForCup is stable for same (lineId, cupIdx)", () => {
    const a = pickDefaultForCup("line-abc", 0);
    const b = pickDefaultForCup("line-abc", 0);
    expect(a.key).toBe(b.key);
  });

  it("pickDefaultForCup distributes across pool over many inputs", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(pickDefaultForCup(`line-${i}`, 0).key);
    }
    expect(seen.size).toBeGreaterThanOrEqual(POOL.length);
  });

  it("hashSeed is deterministic", () => {
    expect(hashSeed("foo:0")).toBe(hashSeed("foo:0"));
  });
});
