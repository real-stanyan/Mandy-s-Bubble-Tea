import { describe, expect, it } from "vitest";
import {
  LOOPS,
  crownHop,
  matrixAt,
  matrixString,
  rotateAbout,
  swing,
  tiltAngle,
  translate,
  waveOffset,
} from "./category-art";
import { CATEGORY_ART_TINT, categoryArtKind } from "@/lib/menu/category-art";

// The web half of the App's lib/motion/category-art.test.ts — same numbers,
// so a change to one repo's vocabulary that is not made in the other fails
// here rather than on someone's phone.

const apply = (m: number[], x: number, y: number) => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];
const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

describe("which drawing a category gets", () => {
  it("knows the eight production categories, in every spelling the catalog has used", () => {
    expect(categoryArtKind("TOP 10")).toBe("top10");
    expect(categoryArtKind("MILK TEA")).toBe("milk");
    expect(categoryArtKind("Milky")).toBe("milk");
    expect(categoryArtKind("FRUITY GREEN TEA")).toBe("green");
    expect(categoryArtKind("FRUITY BLACK TEA")).toBe("black");
    expect(categoryArtKind("FRESH BREW")).toBe("brew");
    expect(categoryArtKind("FROZEN")).toBe("frozen");
    expect(categoryArtKind("CHEESE CREAM")).toBe("cheese");
    expect(categoryArtKind("SPECIAL MIX")).toBe("mix");
  });

  it("gives this week's specials the price-tag drawing, and unknown categories none", () => {
    expect(categoryArtKind("WEEKLY SPECIALS")).toBe("specials");
    expect(categoryArtKind("Seasonal")).toBeNull();
    expect(categoryArtKind(null)).toBeNull();
  });

  it("has a tint for every drawing", () => {
    for (const k of [
      "top10",
      "milk",
      "green",
      "black",
      "brew",
      "frozen",
      "cheese",
      "mix",
      "specials",
    ] as const) {
      expect(CATEGORY_ART_TINT[k]).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe("matrices", () => {
  it("matrixAt places a shape drawn around the origin", () => {
    expect(close(apply(matrixAt(100, 50), 0, 0), [100, 50])).toBe(true);
    expect(close(apply(matrixAt(100, 50, 0, 2), 1, 0), [102, 50])).toBe(true);
    expect(close(apply(matrixAt(100, 50, 90), 1, 0), [100, 51])).toBe(true);
    expect(close(apply(matrixAt(100, 50, 0, 1, 3, -4), 0, 0), [103, 46])).toBe(true);
  });

  it("rotateAbout keeps the pivot still and turns the rest", () => {
    const m = rotateAbout(90, 10, 10);
    expect(close(apply(m, 10, 10), [10, 10])).toBe(true);
    expect(close(apply(m, 20, 10), [10, 20])).toBe(true);
  });

  it("translate is what it says", () => {
    expect(translate(3, 4)).toEqual([1, 0, 0, 1, 3, 4]);
  });

  it("serialises to an SVG transform, rounded so the attribute stays short", () => {
    expect(matrixString(translate(3, 4))).toBe("matrix(1,0,0,1,3,4)");
    expect(matrixString(matrixAt(10, 20, 30))).toBe("matrix(0.866,0.5,-0.5,0.866,10,20)");
    expect(matrixString(matrixAt(0, 0, 45))).not.toMatch(/NaN|e-/);
  });
});

describe("loops", () => {
  it("every loop ends where it began, so the repeat has no seam", () => {
    for (const [name, fn] of Object.entries(LOOPS)) {
      const a = fn(0);
      const b = fn(0.999999);
      // The one-way loops (spin, fall, bubble, wisp, sweep, ripple) fade or wrap instead.
      if (["spin", "fall", "bubble", "wisp", "sweep", "ripple"].includes(name)) continue;
      expect(Math.abs(a.ty - b.ty)).toBeLessThan(0.05);
      expect(Math.abs(a.rot - b.rot)).toBeLessThan(0.5);
      expect(Math.abs(a.scale - b.scale)).toBeLessThan(0.01);
    }
  });

  it("the fading loops are invisible at both ends (a ripple starts visible and fades)", () => {
    for (const name of ["fall", "bubble", "wisp", "sweep"] as const) {
      expect(LOOPS[name](0).opacity).toBeLessThan(0.05);
      expect(LOOPS[name](0.9999).opacity).toBeLessThan(0.05);
    }
    expect(LOOPS.ripple(0).opacity).toBeGreaterThan(0.5);
    expect(LOOPS.ripple(0.9999).opacity).toBeLessThan(0.05);
  });

  it("opacity and scale stay in range", () => {
    for (const fn of Object.values(LOOPS)) {
      for (let p = 0; p < 1; p += 0.05) {
        const f = fn(p);
        expect(f.opacity).toBeGreaterThanOrEqual(0);
        expect(f.opacity).toBeLessThanOrEqual(1);
        expect(f.scale).toBeGreaterThan(0);
      }
    }
  });

  it("the crown rests at its angle and hops once late in the cycle", () => {
    expect(crownHop(0.3)).toMatchObject({ rot: -14, ty: 0 });
    expect(crownHop(0.76).ty).toBeCloseTo(-6, 5);
    expect(crownHop(0.999).ty).toBeCloseTo(0, 1);
  });

  it("the cheese cup tilts to 42° and comes back", () => {
    expect(tiltAngle(0)).toBe(0);
    expect(tiltAngle(0.5)).toBe(42);
    expect(tiltAngle(0.24)).toBeGreaterThan(0);
    expect(tiltAngle(0.24)).toBeLessThan(42);
    expect(tiltAngle(0.95)).toBe(0);
  });

  it("the specials tag glides left to right, then drifts back", () => {
    // A tag hangs below its knot, so matrixAt puts its face at x = -sin(rot):
    // positive rot is LEFT, negative is RIGHT. Left to right therefore runs
    // +22 -> -22, and it crosses the vertical rather than fluttering on one
    // side of the knot.
    expect(swing(0).rot).toBe(22);
    expect(swing(0.3).rot).toBeCloseTo(-22, 5);
    // Rightward the whole way across — no doubling back mid-glide.
    for (let p = 0.03; p <= 0.3; p += 0.03) {
      expect(swing(p).rot).toBeLessThan(swing(p - 0.03).rot);
    }
    // The arc opens to the RIGHT. Against the resting angle Specials hangs it
    // at, the throw runs 20° to -24°: the longer half is out past the rim,
    // not back over the cup. Hung the other way round it reads as a left-hand
    // flutter even though it crosses, which is what shipped in #375.
    const SPECIALS_REST = -2;
    const left = SPECIALS_REST + swing(0).rot;
    const right = SPECIALS_REST + swing(0.3).rot;
    expect(left).toBe(20);
    expect(right).toBe(-24);
    expect(Math.abs(right)).toBeGreaterThan(Math.abs(left));
    // The eye follows whichever stroke is faster, so the glide right has to
    // outrun the drift back. This is the assertion that makes it read as a
    // direction: with the two swapped, the same path reads as drifting LEFT.
    const speed = (a: number, b: number) => Math.abs(swing(b).rot - swing(a).rot) / (b - a);
    expect(speed(0.14, 0.16)).toBeGreaterThan(1.5 * speed(0.73, 0.75));
    // One bounce at the end of the throw, then home, so the loop has no seam.
    expect(swing(0.4).rot).toBeCloseTo(-13, 5);
    expect(swing(0.999).rot).toBeCloseTo(22, 1);
  });

  it("the surface scrolls exactly one wavelength per cycle", () => {
    expect(waveOffset(0, 12)).toBeCloseTo(0);
    expect(waveOffset(1, 12)).toBe(-12);
  });
});
