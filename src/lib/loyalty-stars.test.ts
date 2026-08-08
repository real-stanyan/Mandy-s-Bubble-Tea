import { describe, expect, it } from "vitest";
import { starTrack, NUDGE_THRESHOLD } from "./loyalty-stars";

/**
 * The rule this pins: only a customer who is genuinely close gets told so.
 *
 * A pulse that runs at every balance is wallpaper — people stop seeing it, and
 * the one moment it would have mattered passes unnoticed. The 2026-08-08 sales
 * pull sized that moment: 193 customers sitting on 7–8 of the 9 stars a free
 * drink costs.
 */

const GOAL = 9;

describe("starTrack", () => {
  it("fills one star per earned star", () => {
    const t = starTrack(3, GOAL);
    expect(t.states.filter((s) => s === "filled")).toHaveLength(3);
    expect(t.states).toHaveLength(GOAL);
  });

  it("stays quiet in the middle of a cycle", () => {
    const t = starTrack(4, GOAL);
    expect(t.states).not.toContain("next");
    expect(t.nudge).toBeNull();
  });

  it("lights the next star at two away — the 193-customer case", () => {
    const t = starTrack(7, GOAL);
    expect(t.remaining).toBe(2);
    expect(t.states[7]).toBe("next");
    expect(t.nudge).toBe("2 more cups and your next drink is on us");
  });

  it("uses the singular at one away", () => {
    const t = starTrack(8, GOAL);
    expect(t.nudge).toBe("1 more cup and your next drink is on us");
  });

  it("marks a banked reward instead of counting up to it", () => {
    const t = starTrack(9, GOAL);
    expect(t.rewardReady).toBe(true);
    expect(t.remaining).toBe(0);
    expect(t.nudge).toContain("Free drink ready");
  });

  it("does not nag about the next cycle while a reward is unspent", () => {
    // balance 17 with goal 9 = one drink banked, 8 into the next cycle. The
    // headline is the drink they already have, not the one after it.
    const t = starTrack(17, GOAL);
    expect(t.rewardReady).toBe(true);
    expect(t.states).not.toContain("next");
    expect(t.nudge).toContain("Free drink ready");
  });

  it("wraps into the new cycle after a redemption", () => {
    const t = starTrack(11, GOAL);
    expect(t.states.filter((s) => s === "filled")).toHaveLength(2);
  });

  it("survives a zero or missing balance", () => {
    expect(starTrack(0, GOAL).states.every((s) => s === "empty")).toBe(true);
    expect(starTrack(Number.NaN, GOAL).remaining).toBe(GOAL);
    expect(starTrack(-5, GOAL).states.every((s) => s === "empty")).toBe(true);
  });

  it("survives a nonsense goal rather than rendering an empty track", () => {
    expect(starTrack(3, 0).states.length).toBeGreaterThan(0);
  });

  it("keeps the nudge window where the constant says it is", () => {
    // Guards against the threshold and the copy drifting apart.
    expect(starTrack(GOAL - NUDGE_THRESHOLD, GOAL).nudge).not.toBeNull();
    expect(starTrack(GOAL - NUDGE_THRESHOLD - 1, GOAL).nudge).toBeNull();
  });
});
