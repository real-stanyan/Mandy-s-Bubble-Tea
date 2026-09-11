import { describe, expect, it } from "vitest";
import {
  COMMIT_FRACTION,
  FLICK_VELOCITY,
  OVERDRAG_PX,
  SEAM_OVERLAP,
  blendVelocity,
  dragOffset,
  ghostX,
  lockAxis,
  neighbourIndex,
  overdrag,
  seamOverlap,
  shouldCommit,
  windowIndex,
} from "./swipe-nav";

const W = 390;
const COUNT = 4;

describe("lockAxis", () => {
  it("has no opinion until the finger has moved", () => {
    expect(lockAxis(4, 3)).toBe("none");
    expect(lockAxis(-9, 9)).toBe("none");
  });

  it("calls a clear sideways move a swipe", () => {
    expect(lockAxis(20, 4)).toBe("horizontal");
    expect(lockAxis(-30, -10)).toBe("horizontal");
  });

  it("leaves the diagonal and the vertical to the page", () => {
    expect(lockAxis(14, 14)).toBe("vertical");
    expect(lockAxis(5, 30)).toBe("vertical");
  });
});

describe("dragOffset", () => {
  it("follows the finger when there is a tab to reach", () => {
    expect(dragOffset(-120, true)).toBe(-120);
    expect(dragOffset(80, true)).toBe(80);
  });

  it("gives past the ends, but never more than OVERDRAG_PX", () => {
    expect(dragOffset(-400, false)).toBeGreaterThan(-OVERDRAG_PX);
    expect(dragOffset(400, false)).toBeLessThan(OVERDRAG_PX);
    expect(dragOffset(-400, false)).toBeCloseTo(-overdrag(400));
    // 1:1 at first, so the first points do not feel stuck.
    expect(overdrag(0.5) / 0.5).toBeGreaterThan(0.99);
    let prev = 0;
    for (const px of [10, 40, 100, 300]) {
      expect(overdrag(px)).toBeGreaterThan(prev);
      prev = overdrag(px);
    }
  });
});

describe("neighbourIndex", () => {
  it("heads to the next tab on a leftward drag and the previous on a rightward one", () => {
    expect(neighbourIndex(0, -30, COUNT)).toBe(1);
    expect(neighbourIndex(2, 30, COUNT)).toBe(1);
  });

  it("has nowhere to go past either end", () => {
    expect(neighbourIndex(0, 30, COUNT)).toBeNull();
    expect(neighbourIndex(COUNT - 1, -30, COUNT)).toBeNull();
    expect(neighbourIndex(1, 0, COUNT)).toBeNull();
  });
});

describe("shouldCommit", () => {
  it("turns the page after a long enough drag, however slow", () => {
    expect(shouldCommit(-W * COMMIT_FRACTION, 0, W)).toBe(true);
    expect(shouldCommit(-W * COMMIT_FRACTION + 1, 0, W)).toBe(false);
  });

  it("turns the page on a flick, if the flick agrees with the drag", () => {
    expect(shouldCommit(-40, -(FLICK_VELOCITY + 0.2), W)).toBe(true);
    // Dragged left, then flicked back right: stay.
    expect(shouldCommit(-40, FLICK_VELOCITY + 0.2, W)).toBe(false);
    // A flick with almost no travel is a tremor, not a turn.
    expect(shouldCommit(-10, -(FLICK_VELOCITY + 0.2), W)).toBe(false);
  });
});

describe("the frosted pane", () => {
  it("grows its overlap in over the first stretch of the drag", () => {
    expect(seamOverlap(0)).toBe(0);
    expect(seamOverlap(-60)).toBeGreaterThan(0);
    expect(seamOverlap(-60)).toBeLessThan(SEAM_OVERLAP);
    expect(seamOverlap(-300)).toBe(SEAM_OVERLAP);
  });

  it("waits off screen before the drag, from the side it will come from", () => {
    // Coming from the right: its visible left edge sits at the viewport edge.
    expect(ghostX(0, 1, W)).toBe(W + SEAM_OVERLAP);
    // Coming from the left: its visible right edge sits at x = 0.
    expect(ghostX(0, -1, W)).toBe(-W - SEAM_OVERLAP);
  });

  it("covers the viewport exactly at a full turn, feathered edge gone", () => {
    expect(ghostX(-W, 1, W)).toBe(0);
    expect(ghostX(W, -1, W)).toBe(0);
  });

  it("rides SEAM_OVERLAP over the page mid-drag", () => {
    const off = -W / 2;
    const paneLeft = ghostX(off, 1, W) - SEAM_OVERLAP;
    const pageRight = W + off;
    expect(pageRight - paneLeft).toBeCloseTo(SEAM_OVERLAP);
    const off2 = W / 2;
    const paneRight = ghostX(off2, -1, W) + W + SEAM_OVERLAP;
    const pageLeft = off2;
    expect(paneRight - pageLeft).toBeCloseTo(SEAM_OVERLAP);
  });
});

describe("windowIndex", () => {
  it("moves the pill window with the finger, in tabs", () => {
    expect(windowIndex(0, -W / 2, W, COUNT)).toBeCloseTo(0.5);
    expect(windowIndex(2, W / 4, W, COUNT)).toBeCloseTo(1.75);
  });

  it("stays within the pill past the ends", () => {
    expect(windowIndex(0, 200, W, COUNT)).toBe(0);
    expect(windowIndex(3, -200, W, COUNT)).toBe(3);
  });
});

describe("blendVelocity", () => {
  it("leans on history so one wild sample cannot decide the turn", () => {
    const v = blendVelocity(0, 2);
    expect(v).toBeLessThan(2);
    expect(v).toBeGreaterThan(0);
    expect(blendVelocity(1, 1)).toBe(1);
  });
});
