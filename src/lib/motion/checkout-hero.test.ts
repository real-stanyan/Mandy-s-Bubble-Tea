import { describe, expect, it } from "vitest";
import {
  HERO_LOOPS,
  beckon,
  chime,
  ding,
  flapFor,
  packEnd,
  packFor,
  ringLeft,
  ringRight,
} from "./checkout-hero";
import { HERO_MAX_CUPS, extraCups, orderCups } from "@/lib/menu/order-cups";

const line = (name: string, quantity: number, mods: string[] = []) => ({
  name,
  quantity,
  modifiers: mods.map((m) => ({ name: m })),
});

describe("the cups the heroes draw", () => {
  it("draws one cup per unit, in cart order, from the same mapper as the item sheet", () => {
    const cups = orderCups([
      line("Brown Sugar Milk Tea", 2, ["Pearls"]),
      line("Mango Slushy", 1, ["Rainbow Jelly"]),
    ]);
    expect(cups).toHaveLength(3);
    expect(cups[0].toppings[0]?.shape).toBe("pearl");
    expect(cups[1]).toBe(cups[0]);
    expect(cups[2].toppings[0]?.shape).toBe("cube");
  });

  it("caps at four and counts the rest for the ticket", () => {
    const lines = [
      line("Taro Milk Tea", 3),
      line("Thai Milk Tea", 2),
      line("Lychee Iced Green Tea", 1),
    ];
    expect(orderCups(lines)).toHaveLength(HERO_MAX_CUPS);
    expect(extraCups(lines)).toBe(2);
    expect(extraCups([line("Taro Milk Tea", 1)])).toBe(0);
  });

  it("keeps foam as a layer on the cup it belongs to", () => {
    const [cup] = orderCups([line("Blueberry Cheese", 1, ["Cheese Cream"])]);
    expect(cup.hasFoam).toBe(true);
  });
});

describe("pickup loops", () => {
  it("the paw rises, holds, and comes down in one cycle", () => {
    expect(beckon(0).rot).toBe(0);
    expect(beckon(0.5).rot).toBe(-22);
    expect(beckon(0.999).rot).toBeCloseTo(0, 1);
  });

  it("the bell is pressed only at the top of the cycle", () => {
    expect(ding(0.04).sy).toBeCloseTo(0.82, 5);
    expect(ding(0.5).sy).toBe(1);
  });

  it("the sound arcs leave in opposite directions and are gone by a third", () => {
    expect(ringLeft(0.14).tx).toBeLessThan(0);
    expect(ringRight(0.14).tx).toBeGreaterThan(0);
    expect(ringLeft(0.14).opacity).toBeGreaterThan(0.3);
    expect(ringLeft(0.5).opacity).toBe(0);
  });
});

describe("delivery loops", () => {
  it("the chime rings early and is silent after", () => {
    expect(chime(0.1).opacity).toBeGreaterThan(0.5);
    expect(chime(0.6).opacity).toBe(0);
  });

  it("cups go in one after another, and the lid closes after the last one", () => {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const cup = packFor(i);
      const start = 0.06 + i * 0.18;
      expect(cup(start - 0.01).opacity).toBe(0);
      expect(cup(start + 0.06).ty).toBeCloseTo(-52, 5);
      expect(cup(start + 0.2).ty).toBeCloseTo(0, 5);
      expect(cup(0.999).ty).toBeCloseTo(0, 5);
    }
    const lid = flapFor(n);
    expect(lid(0.2).rot).toBe(-42);
    expect(lid(packEnd(n)).rot).toBe(-42);
    expect(lid(0.999).rot).toBeCloseTo(0, 1);
  });

  it("four cups still close the lid before the cycle ends", () => {
    const lid = flapFor(4);
    expect(lid(packEnd(4) + 0.02).rot).toBe(-42);
    expect(lid(0.999).rot).toBeCloseTo(0, 1);
  });

  it("every named loop keeps opacity and scale sane", () => {
    for (const fn of Object.values(HERO_LOOPS)) {
      for (let p = 0; p < 1; p += 0.05) {
        const f = fn(p);
        expect(f.opacity).toBeGreaterThanOrEqual(0);
        expect(f.opacity).toBeLessThanOrEqual(1);
        expect(f.scale).toBeGreaterThan(0);
      }
    }
  });
});
