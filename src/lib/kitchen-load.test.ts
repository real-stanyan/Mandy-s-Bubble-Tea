import { describe, it, expect } from "vitest";
import {
  kitchenLevelFor,
  kitchenLoadFor,
  kitchenMoodLabel,
  KITCHEN_LOAD_FALLBACK,
  QUIET_MAX_CUPS,
  MEDIUM_MAX_CUPS,
} from "./kitchen-load";

describe("kitchen load brackets (Stan, 2026-09-04)", () => {
  it("quiet: 2–3 min up to the quiet ceiling", () => {
    expect(kitchenLoadFor(0)).toMatchObject({ level: "quiet", minMinutes: 2, maxMinutes: 3, label: "2–3 min" });
    expect(kitchenLevelFor(QUIET_MAX_CUPS)).toBe("quiet");
  });

  it("medium: 5–7 min from one cup past quiet up to the medium ceiling", () => {
    expect(kitchenLevelFor(QUIET_MAX_CUPS + 1)).toBe("medium");
    expect(kitchenLoadFor(MEDIUM_MAX_CUPS)).toMatchObject({ level: "medium", label: "5–7 min" });
  });

  it("busy: 7–10 min past the medium ceiling, however deep the queue", () => {
    expect(kitchenLoadFor(MEDIUM_MAX_CUPS + 1)).toMatchObject({ level: "busy", label: "7–10 min" });
    expect(kitchenLoadFor(60).level).toBe("busy");
  });

  it("never reports a negative or fractional queue", () => {
    expect(kitchenLoadFor(-4).pendingCups).toBe(0);
    expect(kitchenLoadFor(2.9).pendingCups).toBe(2);
  });

  it("fallback is the middle bracket — early beats late when we can't see the queue", () => {
    expect(KITCHEN_LOAD_FALLBACK.level).toBe("medium");
  });

  it("mood copy exists for every level", () => {
    expect(kitchenMoodLabel("quiet")).toMatch(/quiet/);
    expect(kitchenMoodLabel("medium")).toMatch(/busy/);
    expect(kitchenMoodLabel("busy")).toMatch(/busy/);
  });
});
