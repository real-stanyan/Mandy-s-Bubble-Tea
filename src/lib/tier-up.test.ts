// src/lib/tier-up.test.ts
import { describe, expect, it } from "vitest";
import { shouldCelebrate } from "@/lib/tier-up";

describe("shouldCelebrate", () => {
  it("never celebrates on first visit (null prev — just store it)", () => {
    expect(shouldCelebrate(null, "silver")).toBe(false);
    expect(shouldCelebrate(null, "gold")).toBe(false);
    expect(shouldCelebrate(null, "diamond")).toBe(false);
  });

  it("ignores garbage localStorage values", () => {
    expect(shouldCelebrate("platinum", "diamond")).toBe(false);
    expect(shouldCelebrate("", "gold")).toBe(false);
    expect(shouldCelebrate("GOLD", "diamond")).toBe(false);
  });

  it("celebrates silver → gold", () => {
    expect(shouldCelebrate("silver", "gold")).toBe(true);
    expect(shouldCelebrate("silver", "diamond")).toBe(true);
  });

  it("does not celebrate same tier", () => {
    expect(shouldCelebrate("silver", "silver")).toBe(false);
    expect(shouldCelebrate("gold", "gold")).toBe(false);
    expect(shouldCelebrate("diamond", "diamond")).toBe(false);
  });

  it("celebrates gold → diamond", () => {
    expect(shouldCelebrate("gold", "diamond")).toBe(true);
  });

  it("does not celebrate downgrades", () => {
    expect(shouldCelebrate("diamond", "gold")).toBe(false);
    expect(shouldCelebrate("gold", "silver")).toBe(false);
  });
});
