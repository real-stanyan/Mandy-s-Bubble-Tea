import { describe, it, expect } from "vitest";
import type { CupLabelSelection } from "@/store/cart";
import { computeCupLabelGate } from "./checkout-gate";

describe("computeCupLabelGate", () => {
  it("is ready with no cups", () => {
    expect(computeCupLabelGate([])).toBe("ready");
  });

  it("is ready when a cup has no selection (optional → server prints the Mandy logo)", () => {
    // The regression: leaving the cup as the default 'Mandy logo'
    // must NOT keep the Pay button stuck on 'Preparing labels…'.
    expect(computeCupLabelGate([undefined])).toBe("ready");
    expect(computeCupLabelGate([undefined, undefined])).toBe("ready");
  });

  it("is ready for settled preset / photo / ai / draw selections", () => {
    const sels: CupLabelSelection[] = [
      { kind: "preset", hash: "abc" },
      { kind: "photo", uploadedDoodleId: "p1", previewUrl: "x" },
      { kind: "ai", aiDoodleId: "a1", prompt: "cat" },
      { kind: "draw", userDoodleId: "d1", pathCount: 3 },
    ];
    expect(computeCupLabelGate(sels)).toBe("ready");
  });

  it("blocks while an AI image is still rendering", () => {
    expect(computeCupLabelGate([{ kind: "ai", aiDoodleId: null, prompt: "cat" }])).toBe("ai-pending");
  });

  it("blocks while a drawing is still uploading", () => {
    expect(computeCupLabelGate([{ kind: "draw", userDoodleId: null, pathCount: 2 }])).toBe("draw-pending");
  });

  it("does NOT short-circuit on an unselected cup before a later pending upload", () => {
    // Cup 1 unselected (fine), cup 2's AI still in flight → must still block.
    expect(
      computeCupLabelGate([undefined, { kind: "ai", aiDoodleId: null, prompt: "x" }]),
    ).toBe("ai-pending");
  });
});
