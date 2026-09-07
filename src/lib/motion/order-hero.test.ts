import { describe, expect, it } from "vitest";
import type { Frame } from "@/lib/motion/category-art";
import {
  CUP_MOUTH,
  DONE_CUP,
  MAKE,
  POUR_FLOOR,
  STREAM_LEN,
  FILL_DEPTH,
  PREP,
  PREP_PERIOD,
  READY_PERIOD,
  SHAKES,
  TIN,
  arrive,
  cycles,
  dropIn,
  fill,
  handoff,
  noteSway,
  pour,
  press,
  shake,
  shakeArc,
  starDrift,
  ticketFeed,
  tinCorners,
  tinMouth,
} from "./order-hero";

/** Every frame, flattened to the numbers the matrix is actually built from.
 *  `+ 0` normalises −0, which compares unequal to 0 under toEqual. */
function at(f: (p: number) => Frame, p: number) {
  const v = f(p);
  const n = (x: number) => Math.round(x * 1e6) / 1e6 + 0;
  return [
    n(v.tx ?? 0),
    n(v.ty ?? 0),
    n(v.rot ?? 0),
    n(v.scale ?? 1),
    n(v.sy ?? 1),
    n(v.opacity ?? 1),
  ];
}

/** How much of a part is actually on screen — a part scaled to nothing is as
 *  gone as one at zero opacity, and both are fine at the seam. */
const shown = (f: (p: number) => Frame, p: number) => {
  const v = f(p);
  return (v.opacity ?? 1) * Math.abs(v.sy ?? 1) * Math.abs(v.scale ?? 1);
};

// The very numbers the drawing uses, so moving the cup moves the assertion.
const CUP_LEFT = CUP_MOUTH.left;
const CUP_RIGHT = CUP_MOUTH.right;
const CUP_RIM_Y = CUP_MOUTH.rimY;
const HAND = handoff(DONE_CUP.x - MAKE.x, DONE_CUP.y - MAKE.y, 1 - DONE_CUP.s / MAKE.s);

describe("the loop closes", () => {
  // A part visible at the seam has to end the cycle where it began it, or the
  // scene jumps once a pass. That is the whole reason these are pure.
  const onScreenThroughout: [string, (p: number) => Frame][] = [
    ["shake", shake],
    ["shakeArc", shakeArc],
    ["noteSway", noteSway],
    ["starDrift", starDrift(0)],
    ["starDrift (offset)", starDrift(0.34)],
  ];

  it.each(onScreenThroughout)("%s is in the same place at p=1 as at p=0", (_n, fn) => {
    expect(at(fn, 1)).toEqual(at(fn, 0));
  });

  // The rest of the parts are allowed to end the cycle somewhere else — as
  // long as nothing of them is on screen at either end to give it away.
  // These two turn themselves off instead, so they may end anywhere.
  const offAtTheSeam: [string, (p: number) => Frame][] = [
    ["pour", pour(POUR_FLOOR, STREAM_LEN)],
    ["ticketFeed", ticketFeed],
  ];

  it.each(offAtTheSeam)("%s is off screen at both ends of the cycle", (_n, fn) => {
    expect(shown(fn, 0)).toBeLessThan(0.05);
    expect(shown(fn, 1)).toBeLessThan(0.05);
  });

  // And these end the cycle plainly visible in a pose that does NOT match p=0
  // — a full, lidded, strawed cup against an empty one. They are allowed to,
  // because they live inside the group `handoff` drives, and it has faded that
  // whole group out by p=1. Assert the mechanism, not each part against
  // itself: on its own, every one of these would fail, and should.
  const insideTheCupBeingMade: [string, (p: number) => Frame][] = [
    ["fill", fill(FILL_DEPTH)],
    ["dropIn (pearl)", dropIn(PREP.pearlFrom, PREP.pearlFall, -46)],
    ["dropIn (ice)", dropIn(PREP.iceFrom, PREP.iceFall, -40)],
    ["press (lid)", press(PREP.sealFrom, PREP.sealTo, -44)],
    ["press (straw)", press(PREP.strawFrom, PREP.strawTo, -30)],
  ];

  it.each(insideTheCupBeingMade)(
    "%s ends the cycle in a pose only the parent's fade can hide",
    (_n, fn) => {
      expect(at(fn, 1)).not.toEqual(at(fn, 0));
      expect(HAND(1).opacity).toBe(0);
    },
  );

  it("closes the cup being made against the next one, not against itself", () => {
    // `handoff` has faded the finished cup out by p=1, and `arrive` has stood
    // a fresh empty one in exactly the spot the finished cup occupies at p=0.
    // The seam closes across the pair.
    expect(at(arrive(-120), 1)).toEqual(at(HAND, 0));
  });

  it("holds a whole number of sub-loops so the fast parts land on the seam too", () => {
    // 8000/2200 = 3.64 — the wave would be mid-swing at p=1 without this.
    expect(cycles(PREP_PERIOD, 2200)).toBe(4);
    expect(cycles(READY_PERIOD, 3600)).toBe(1);
    // Never zero, however short the scene against however long the sub-loop.
    expect(cycles(1000, 9000)).toBe(1);
  });
});

describe("the tin", () => {
  it("rests, shakes, and comes back to exactly the same rest pose", () => {
    expect(shake(0).rot).toBe(TIN.restRot);
    expect(shake(PREP.shakeFrom - 0.01).rot).toBe(TIN.restRot);
    // Back at rest once the swing has returned, and still there at the seam.
    expect(shake(0.95).rot).toBeCloseTo(TIN.restRot, 6);
    expect(shake(1).rot).toBeCloseTo(TIN.restRot, 6);
  });

  it("actually shakes — the tin swings both ways past its rest angle", () => {
    const rots: number[] = [];
    for (let i = 0; i <= 200; i++) {
      const p = PREP.shakeFrom + (i / 200) * (PREP.shakeTo - PREP.shakeFrom);
      rots.push(shake(p).rot ?? 0);
    }
    expect(Math.max(...rots)).toBeGreaterThan(TIN.restRot + 15);
    expect(Math.min(...rots)).toBeLessThan(TIN.restRot - 15);
  });

  it("swings the mouth over the cup before any liquid comes out", () => {
    const m = tinMouth(PREP.pourFrom);
    expect(m.x).toBeGreaterThan(CUP_LEFT);
    expect(m.x).toBeLessThan(CUP_RIGHT);
    // Above the rim: the liquid has somewhere to fall.
    expect(m.y).toBeLessThan(CUP_RIM_Y);
  });

  it("keeps the mouth over the cup for the whole pour", () => {
    for (let i = 0; i <= 40; i++) {
      const p = PREP.pourFrom + (i / 40) * (PREP.pourTo - PREP.pourFrom);
      const m = tinMouth(p);
      expect(m.x).toBeGreaterThan(CUP_LEFT);
      expect(m.x).toBeLessThan(CUP_RIGHT);
      expect(m.y).toBeLessThan(CUP_RIM_Y);
    }
  });

  it("parks the mouth away from the cup while shaking", () => {
    expect(tinMouth(0.2).x).toBeLessThan(CUP_LEFT);
  });
});

describe("the pour", () => {
  const stream = pour(POUR_FLOOR, STREAM_LEN);

  it("is invisible until the tin is tipped, and gone before it swings back", () => {
    expect(stream(PREP.shakeTo).opacity).toBe(0);
    expect(stream(PREP.pourTo + 0.01).opacity).toBe(0);
    expect(stream((PREP.pourFrom + PREP.pourTo) / 2).opacity).toBeCloseTo(1, 6);
  });

  it("starts at the mouth, wherever the mouth is", () => {
    for (const p of [PREP.pourFrom, 0.6, PREP.pourTo - 0.01]) {
      const m = tinMouth(p);
      const f = stream(p);
      expect(f.tx).toBeCloseTo(m.x, 6);
      expect(f.ty).toBeCloseTo(m.y, 6);
    }
  });

  it("stretches to reach into the cup rather than stopping short", () => {
    const p = 0.6;
    const m = tinMouth(p);
    const f = stream(p);
    expect(m.y + (f.sy ?? 1) * STREAM_LEN).toBeCloseTo(POUR_FLOOR, 6);
    expect(m.y + (f.sy ?? 1) * STREAM_LEN).toBeGreaterThan(CUP_RIM_Y);
  });
});

describe("the cup being made", () => {
  it("is empty at the start of the cycle and full by the end of the pour", () => {
    expect(fill(FILL_DEPTH)(0).ty).toBe(FILL_DEPTH);
    expect(fill(FILL_DEPTH)(PREP.pourTo).ty).toBe(0);
  });

  it("puts the pearls in first — the bed is down long before the tea arrives", () => {
    const last = dropIn(PREP.pearlFrom + 6 * PREP.pearlStagger, PREP.pearlFall, -46);
    // The last pearl is still settling as the shake starts, which is what a
    // pair of busy hands looks like; what matters is that it is down and
    // stays down for the whole pour.
    expect(last(PREP.pourFrom).ty).toBeCloseTo(0, 6);
    expect(last(PREP.pourFrom).opacity).toBe(1);
    expect(last(0).opacity).toBe(0);
  });

  it("drops the ice with the pour — it was shaken in the tin, not added after", () => {
    const ice = dropIn(PREP.iceFrom, PREP.iceFall, -40);
    expect(ice(PREP.pourFrom).opacity).toBe(0);
    expect(ice(PREP.pourTo).opacity).toBe(1);
  });

  it("seals and straws only once the cup is full", () => {
    expect(PREP.sealFrom).toBeGreaterThan(PREP.pourTo);
    expect(PREP.strawFrom).toBeGreaterThanOrEqual(PREP.sealTo);
    expect(press(PREP.sealFrom, PREP.sealTo, -44)(PREP.pourTo).opacity).toBe(0);
  });

  it("lands on the still cup's exact spot and fades out there", () => {
    const f = HAND(1);
    // Not "somewhere on the right" — the still cup's own spot and own size,
    // which is what lets it fade out without anything appearing to vanish.
    expect(MAKE.x + (f.tx ?? 0)).toBeCloseTo(DONE_CUP.x, 6);
    expect(MAKE.y + (f.ty ?? 0)).toBeCloseTo(DONE_CUP.y, 6);
    expect(MAKE.s * (f.scale ?? 1)).toBeCloseTo(DONE_CUP.s, 6);
    expect(f.opacity).toBe(0);
  });

  it("has the next cup standing in place by the time the loop restarts", () => {
    const next = arrive(-120);
    expect(next(1).tx).toBeCloseTo(0, 6);
    expect(next(1).opacity).toBe(1);
    expect(next(0).opacity).toBe(0);
  });
});

describe("the ticket", () => {
  it("is not there at either end of the cycle, and is by the middle", () => {
    expect(ticketFeed(0).sy).toBeCloseTo(0.02, 6);
    expect(ticketFeed(1).opacity).toBe(0);
    expect(ticketFeed(0.6).sy).toBe(1);
    expect(ticketFeed(0.6).opacity).toBe(1);
  });
});

describe("the shake arcs", () => {
  it("only flick while the tin is being shaken", () => {
    expect(shakeArc(0).opacity).toBe(0);
    expect(shakeArc(PREP.pourFrom).opacity).toBe(0);
    const mid = (PREP.shakeFrom + PREP.shakeTo) / 2;
    let seen = 0;
    for (let i = 0; i < SHAKES * 4; i++) {
      const p = PREP.shakeFrom + (i / (SHAKES * 4)) * (PREP.shakeTo - PREP.shakeFrom);
      if ((shakeArc(p).opacity ?? 1) > 0.4) seen++;
    }
    expect(seen).toBeGreaterThan(0);
    expect(shakeArc(mid).scale).toBeGreaterThan(0);
  });
});

describe("the tin stays out of the cup it is pouring into", () => {
  // The bug this pins: at 125° the far corner of the cap swung ~13 units under
  // the rim, so the tin poured from inside the cup. Tilt, lift and the tin's
  // own size are all set by this assertion rather than by eye — change any one
  // of them and this is what tells you.
  it("keeps every corner of the tin above the rim for the whole pour", () => {
    for (let i = 0; i <= 60; i++) {
      const p = PREP.pourFrom + (i / 60) * (PREP.pourTo - PREP.pourFrom);
      for (const c of tinCorners(p)) {
        expect(c.y).toBeLessThan(CUP_MOUTH.rimY);
      }
    }
  });

  it("leaves the tin room to swing without clipping the stage", () => {
    for (let i = 0; i <= 100; i++) {
      for (const c of tinCorners(i / 100)) {
        expect(c.x).toBeGreaterThan(0);
        expect(c.x).toBeLessThan(360);
        expect(c.y).toBeGreaterThan(0);
        expect(c.y).toBeLessThan(200);
      }
    }
  });
});
