import { describe, it, expect } from "vitest";
import { freshness, STALE_AFTER_SEC } from "./delivery-freshness";

const T0 = new Date("2026-06-19T12:00:00.000Z").getTime();
const ago = (sec: number) => new Date(T0 - sec * 1000).toISOString();

describe("freshness", () => {
  it("waiting when no driver / no timestamp", () => {
    expect(freshness(false, ago(5), T0).state).toBe("waiting");
    expect(freshness(true, null, T0).state).toBe("waiting");
  });

  it("live within 15s", () => {
    const f = freshness(true, ago(5), T0);
    expect(f.state).toBe("live");
    expect(f.label).toMatch(/Live/);
  });

  it("recent between 15s and the stale threshold", () => {
    expect(freshness(true, ago(30), T0)).toEqual({
      label: "Updated 30s ago",
      state: "recent",
    });
    expect(freshness(true, ago(70), T0).state).toBe("recent");
  });

  it("stale at/after the threshold — paused, not live", () => {
    const f = freshness(true, ago(STALE_AFTER_SEC), T0);
    expect(f.state).toBe("stale");
    expect(f.label).toMatch(/paused/i);
    expect(freshness(true, ago(19 * 60), T0).state).toBe("stale");
  });

  it("never treats a 19m-old fix as live (the bug)", () => {
    expect(freshness(true, ago(19 * 60), T0).state).not.toBe("live");
  });
});
