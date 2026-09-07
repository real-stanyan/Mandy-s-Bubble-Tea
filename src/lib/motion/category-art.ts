// The category illustrations (components/brand/CategoryArt): the pure maths
// behind every looping motion — a phase p in [0, 1) in, a frame out — and the
// matrices the <g> groups are driven with. Groups animate through their
// `transform` matrix and `opacity` only, set straight on the DOM node from one
// shared rAF ticker, so frames become matrices here rather than CSS.
//
// Mirror of the App's lib/motion/category-art.ts (the App drives the same
// numbers through rn-svg's native `matrix` prop from a Reanimated worklet).
// Keep the two in lockstep. Which drawing a category gets lives in
// lib/menu/category-art.

/* ------------------------------ matrices ------------------------------ */

/** SVG's matrix(): [a, b, c, d, e, f] for x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Place a shape drawn around (0, 0): translate to (x + tx, y + ty), rotated and scaled about its own origin (`sy` squashes y on top of `scale`). */
export function matrixAt(
  x: number,
  y: number,
  rotDeg = 0,
  scale = 1,
  tx = 0,
  ty = 0,
  sy = 1,
): Matrix {
  const r = (rotDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c * scale, s * scale, -s * scale * sy, c * scale * sy, x + tx, y + ty];
}

/** Rotate the plane about a fixed point (the point itself stays put). */
export function rotateAbout(deg: number, cx: number, cy: number): Matrix {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, cx - cx * c + cy * s, cy - cx * s - cy * c];
}

export function translate(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty];
}

/** `matrix(a,b,c,d,e,f)` for an SVG `transform` attribute. */
export function matrixString(m: Matrix): string {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return `matrix(${r(m[0])},${r(m[1])},${r(m[2])},${r(m[3])},${r(m[4])},${r(m[5])})`;
}

/* -------------------------------- loops -------------------------------- */

/** One frame of a moving part; `sy` is an extra squash on y (a bell pressed), 1 when absent. */
export type Frame = {
  tx: number;
  ty: number;
  rot: number;
  scale: number;
  opacity: number;
  sy?: number;
};

/** 0 → 1 → 0, smooth, over one phase. */
export function hump(p: number): number {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
}

/** Fade in over `inEnd`, then out to 0 at 1. */
export function inOut(p: number, inEnd: number, peak: number): number {
  return p < inEnd ? (p / inEnd) * peak : peak * (1 - (p - inEnd) / (1 - inEnd));
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Piecewise keyframes: [phase, value] stops, eased between them. */
export function keyframes(
  p: number,
  stops: readonly (readonly [number, number])[],
): number {
  if (p <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [p1, v1] = stops[i];
    if (p <= p1) {
      const [p0, v0] = stops[i - 1];
      const t = p1 === p0 ? 1 : (p - p0) / (p1 - p0);
      return v0 + (v1 - v0) * easeInOut(t);
    }
  }
  return stops[stops.length - 1][1];
}

export const REST: Frame = { tx: 0, ty: 0, rot: 0, scale: 1, opacity: 1 };

/** Pearls drift up and settle back. */
export function rise(p: number): Frame {
  return { ...REST, ty: -11 * hump(p) };
}
/** A loose pearl / jelly / fruit floats on the spot. */
export function bob(p: number): Frame {
  return { ...REST, ty: -3 * hump(p), rot: -4 + 8 * hump(p) };
}
/** Citrus slice turning. */
export function spin(p: number): Frame {
  return { ...REST, rot: 360 * p };
}
/** A leaf in a breeze. */
export function sway(p: number): Frame {
  return { ...REST, rot: -8 + 16 * hump(p) };
}
/** Frost / sparkle. */
export function twinkle(p: number): Frame {
  const h = hump(p);
  return { ...REST, scale: 0.6 + 0.4 * h, opacity: 0.2 + 0.8 * h };
}
/** A curl of steam rising and thinning. */
export function wisp(p: number): Frame {
  return { ...REST, ty: 6 - 24 * p, opacity: inOut(p, 0.3, 0.75) };
}
/** A tea leaf drifting down. */
export function fall(p: number): Frame {
  return {
    ...REST,
    ty: -8 + 38 * p,
    rot: 70 * p,
    opacity: p < 0.2 ? p / 0.2 : p > 0.9 ? (1 - p) / 0.1 : 1,
  };
}
/** Cold light passing over the slush. */
export function sweep(p: number): Frame {
  return { ...REST, tx: -34 + 68 * p, rot: -18, opacity: inOut(p, 0.35, 0.85) };
}
/** A bubble climbing through the tea. */
export function bubble(p: number): Frame {
  return {
    ...REST,
    ty: -30 * p,
    scale: 0.5 + 0.5 * Math.min(1, p / 0.3),
    opacity: inOut(p, 0.3, 0.9),
  };
}
/** The slush mound breathing. */
export function breathe(p: number): Frame {
  return { ...REST, scale: 1 + 0.04 * hump(p) };
}
/** A ripple ring spreading and fading. */
export function ripple(p: number): Frame {
  return { ...REST, scale: 0.5 + 1.1 * p, opacity: 0.6 * (1 - p) };
}
/** A price tag on a string: a sway of ±14° about its resting angle — the pivot is the knot at the shape's origin. */
export function swing(p: number): Frame {
  return { ...REST, rot: 14 * Math.sin(2 * Math.PI * p) };
}
/** The crown hops once a cycle, otherwise sits at its jaunty angle. */
export function crownHop(p: number): Frame {
  const rot = keyframes(p, [
    [0, -14],
    [0.68, -14],
    [0.76, -22],
    [0.84, -11],
    [0.9, -15],
    [1, -14],
  ]);
  const ty = keyframes(p, [
    [0, 0],
    [0.68, 0],
    [0.76, -6],
    [0.84, 0],
    [0.9, -2],
    [1, 0],
  ]);
  return { ...REST, rot, ty };
}
/** Cheese tea: the angle the cup tilts to (its contents counter-rotate by the same). */
export function tiltAngle(p: number): number {
  return keyframes(p, [
    [0, 0],
    [0.14, 0],
    [0.34, 42],
    [0.62, 42],
    [0.82, 0],
    [1, 0],
  ]);
}
/** The surface ribbon scrolls one wavelength per cycle. */
export function waveOffset(p: number, wavelength: number): number {
  return -wavelength * p;
}

export const LOOPS = {
  rise,
  bob,
  spin,
  sway,
  twinkle,
  wisp,
  fall,
  sweep,
  bubble,
  breathe,
  ripple,
  crownHop,
  swing,
} as const;
export type LoopName = keyof typeof LOOPS;
