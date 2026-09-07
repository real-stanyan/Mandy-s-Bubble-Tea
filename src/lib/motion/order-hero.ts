// The order hero (components/brand/OrderHero): what is happening to the
// customer's drinks right now, drawn on the order page while they wait.
// Pure phase→frame maths for its moving parts; which cups it draws is
// lib/menu/order-cups, the same as the checkout heroes.
//
// The shop is 手摇 — hand-shaken — so the tin is the centre of the Preparing
// scene and gets a third of the loop to itself. Everything else is the order
// a drink is actually built in: pearls into the cup, shake, pour over, seal,
// straw, away.
//
// ONE RULE runs through this file: every frame function must return the same
// frame at p = 1 as at p = 0. A loop whose parts don't agree at the seam shows
// a visible jump once a cycle, which is what the first cut of this scene did
// (the cup shrank away to nothing and then snapped back to full size). The
// test asserts it for every export rather than trusting the reading.

import { REST, hump, keyframes, type Frame } from "@/lib/motion/category-art";

/* -------------------------------- easings -------------------------------- */

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** A window of the cycle, remapped to 0→1 and clamped outside it. */
export function win(p: number, from: number, to: number): number {
  return clamp01((p - from) / (to - from));
}
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/**
 * How many whole times a sub-loop of `ms` fits in a cycle of `period`.
 *
 * Rounded, never fractional: the wave surface runs at 2.2s inside an 8s scene,
 * and 8000/2200 = 3.64 leaves the wave mid-swing at p=1 and snaps it back at
 * p=0. Rounding to 4 costs 10% of the wave's speed and buys a seam nobody can
 * see. Same for the cats, the bell and the sparkles.
 */
export function cycles(period: number, ms: number): number {
  return Math.max(1, Math.round(period / ms));
}

/* -------------------------------- timing --------------------------------- */

/** The Preparing loop, in phase. One cycle is PREP_PERIOD ms. */
export const PREP = {
  pearlFrom: 0.004,
  pearlStagger: 0.008,
  pearlFall: 0.06,
  shakeFrom: 0.08,
  shakeTo: 0.42,
  tip: 0.46,
  pourFrom: 0.5,
  pourTo: 0.72,
  /** How long the tin takes to swing back to rest after pouring. */
  tipBack: 0.1,
  iceFrom: 0.55,
  iceStagger: 0.05,
  iceFall: 0.07,
  sealFrom: 0.76,
  sealTo: 0.84,
  strawFrom: 0.86,
  strawTo: 0.92,
  handFrom: 0.9,
  handTo: 0.985,
  handFade: 0.975,
} as const;

export const PREP_PERIOD = 8000;
export const RECEIVED_PERIOD = 5200;
export const READY_PERIOD = 3600;
export const DONE_PERIOD = 4200;

/** Eleven shakes a cycle. Fewer reads as stirring, more as a blur. */
export const SHAKES = 11;

/* ------------------------------- the stage -------------------------------- */

// Stage geometry lives here rather than in the component so the pour and the
// cup can't drift apart: the aim is asserted in the test against the very
// numbers the drawing uses.

/** The counter, at the height the checkout hero puts it, so the two scenes
 *  sit in the same room. */
export const COUNTER_Y = 136;
/** The cup being made: bigger than the finished ones, and centred. */
export const MAKE = { x: 150, s: 0.85, y: COUNTER_Y - 78 * 0.85 } as const;
/** Where it goes when it's done — exactly where the still cup already stands. */
export const DONE_CUP = { x: 270, y: 80, s: 0.72 } as const;
/** Below the rim, so the cup's own front hides the end of the pour. */
export const POUR_FLOOR = 96;
export const STREAM_LEN = 40;
export const LIQ_TOP = 30;
/** How far the liquid starts below the surface line, in the cup's own units. */
export const FILL_DEPTH = 48;

/** The mouth of the cup being made, in stage coordinates — what the pour has
 *  to land inside of. */
export const CUP_MOUTH = {
  left: MAKE.x + 12 * MAKE.s,
  right: MAKE.x + 48 * MAKE.s,
  rimY: MAKE.y + 18 * MAKE.s,
} as const;

/** The tin's stage geometry, shared by the drawing and by tinMouth(). */
export const TIN = {
  x: 108,
  y: 64,
  restRot: -6,
  /** The mouth, in the tin's own coordinates: the opening under the cap. */
  mouthY: -38,
  pourRot: 125,
  pourTx: 42,
  pourTy: -8,
} as const;

/* --------------------------------- the tin -------------------------------- */

/**
 * The tin: rest, eleven shakes, one swing out over the cup and back to rest.
 *
 * The swing is a single interpolation between the rest pose and the pouring
 * pose rather than a branch per beat — three branches each landed somewhere
 * slightly different, and the tin arrived at p=1 a few degrees off where it
 * starts at p=0.
 */
export function shake(p: number): Frame {
  if (p < PREP.shakeFrom) return { ...REST, rot: TIN.restRot };
  if (p <= PREP.shakeTo) {
    const t = win(p, PREP.shakeFrom, PREP.shakeTo);
    const env = Math.sin(t * Math.PI); // in and out of the shake, not a hard start
    const osc = Math.sin(t * Math.PI * 2 * SHAKES);
    return {
      ...REST,
      rot: TIN.restRot + 30 * osc * env,
      tx: 7 * osc * env,
      ty: -4 * Math.cos(t * Math.PI * 2 * SHAKES) * env,
    };
  }
  const k =
    easeInOut(win(p, PREP.tip, PREP.pourFrom)) *
    (1 - easeInOut(win(p, PREP.pourTo, PREP.pourTo + PREP.tipBack)));
  return {
    ...REST,
    tx: TIN.pourTx * k,
    ty: TIN.pourTy * k,
    rot: TIN.restRot + (TIN.pourRot - TIN.restRot) * k,
  };
}

/**
 * Where the tin's mouth is on the stage this frame — matrixAt applied to the
 * mouth's local point.
 *
 * The pour hangs off this rather than off a hand-placed coordinate. The first
 * cut put the stream at a fixed spot that merely sat near the spout, so it
 * detached the moment the tin moved.
 */
export function tinMouth(p: number): { x: number; y: number } {
  const f = shake(p);
  const r = ((f.rot ?? 0) * Math.PI) / 180;
  return {
    x: TIN.x + (f.tx ?? 0) + -Math.sin(r) * TIN.mouthY,
    y: TIN.y + (f.ty ?? 0) + Math.cos(r) * TIN.mouthY,
  };
}

/** The shake read as speed: an arc flicking on each beat, a side each. */
export function shakeArc(p: number): Frame {
  if (p < PREP.shakeFrom || p > PREP.shakeTo) return { ...REST, opacity: 0 };
  const t = win(p, PREP.shakeFrom, PREP.shakeTo);
  const beat = (t * SHAKES) % 1;
  return {
    ...REST,
    opacity: Math.sin(t * Math.PI) * (beat < 0.5 ? 0.85 : 0.15),
    scale: 0.8 + 0.3 * beat,
  };
}

/**
 * The pour: it starts at the mouth wherever the mouth is and falls straight
 * down — gravity does not tip with the tin — stretched to reach `floorY`,
 * which sits below the cup's rim so the cup's own front hides the end of it.
 *
 * `sy` scales a stream drawn `len` tall, so the caller draws one rect.
 */
export function pour(floorY: number, len: number) {
  return (p: number): Frame => {
    if (p < PREP.pourFrom - 0.03 || p > PREP.pourTo) {
      return { ...REST, opacity: 0, sy: 0.01 };
    }
    const m = tinMouth(p);
    const lead = Math.min(1, win(p, PREP.pourFrom - 0.03, PREP.pourFrom + 0.02));
    const tail = 1 - win(p, PREP.pourTo - 0.04, PREP.pourTo);
    return {
      ...REST,
      tx: m.x,
      ty: m.y,
      sy: Math.max(6, floorY - m.y) / len,
      opacity: lead * tail,
    };
  };
}

/** The liquid climbing the cup as it is poured; `depth` is the empty distance. */
export function fill(depth: number) {
  return (p: number): Frame => ({
    ...REST,
    ty: depth * (1 - easeInOut(win(p, PREP.pourFrom, PREP.pourTo))),
  });
}

/** A pearl or an ice cube going in: hidden, then dropped, with a small squash. */
export function dropIn(start: number, over: number, from: number) {
  return (p: number): Frame => {
    if (p < start) return { ...REST, ty: from, opacity: 0 };
    const t = win(p, start, start + over);
    return {
      ...REST,
      ty: from * (1 - easeOut(t)),
      opacity: 1,
      sy: t > 0.9 ? 1 - 0.14 * Math.sin(((t - 0.9) / 0.1) * Math.PI) : 1,
    };
  };
}

/** The lid coming down off the sealer, then the straw through it. */
export function press(from: number, to: number, above: number) {
  return (p: number): Frame => {
    if (p < from) return { ...REST, ty: above, opacity: 0 };
    return { ...REST, ty: above * (1 - easeOut(win(p, from, to))), opacity: 1 };
  };
}

/**
 * The finished cup joining the ones already made.
 *
 * It lands on the still cup's EXACT spot and size and fades out there, with
 * that still cup already drawn underneath — so at p=1 there is nothing left
 * of it to disagree with p=0, and the handover has nothing to show.
 */
export function handoff(tx: number, ty: number, shrink: number) {
  return (p: number): Frame => {
    const e = easeInOut(win(p, PREP.handFrom, PREP.handTo));
    return {
      ...REST,
      tx: tx * e,
      ty: ty * e,
      scale: 1 - shrink * e,
      opacity: 1 - win(p, PREP.handFade, 1),
    };
  };
}

/** The next empty cup arriving as the finished one leaves. At p=1 it stands
 *  exactly where the cup being made stands at p=0 — the other half of the seam. */
export function arrive(from: number) {
  return (p: number): Frame => {
    if (p < PREP.handFrom) return { ...REST, tx: from, opacity: 0 };
    return {
      ...REST,
      tx: from * (1 - easeInOut(win(p, PREP.handFrom, 1))),
      opacity: Math.min(1, win(p, PREP.handFrom, PREP.handFrom + 0.04)),
    };
  };
}

/* ------------------------------- the ticket ------------------------------- */

/** The order ticket feeding out of the printer, then stirring in the air-con.
 *  Torn off at the end: at p=1 there is no ticket, which is what p=0 draws. */
export function ticketFeed(p: number): Frame {
  const out = easeOut(win(p, 0.06, 0.44));
  return {
    ...REST,
    sy: Math.max(0.02, out),
    opacity: 1 - win(p, 0.93, 1),
    rot: out < 1 ? 0 : -6 + 4 * hump(win(p, 0.44, 0.93)),
  };
}

/* -------------------------------- picked up ------------------------------- */

/** A star earned on this order, drifting up and fading out both ends. */
export function starDrift(offset: number) {
  return (p: number): Frame => {
    const q = (p + offset) % 1;
    return {
      ...REST,
      ty: -56 * q,
      scale: 0.7 + 0.4 * q,
      opacity: q < 0.18 ? q / 0.18 : 1 - (q - 0.18) / 0.82,
    };
  };
}

/** The thank-you note left on the counter, stirring where the cups were. */
export function noteSway(p: number): Frame {
  return { ...REST, rot: -5 + 3 * hump(p) };
}

/** The lucky cat's paw, at the pace of whatever scene it stands in. */
export function beckonAt(period: number, delayMs: number) {
  const n = cycles(period, 1600);
  const d = delayMs / 1600;
  return (p: number): Frame => {
    const q = (p * n + d) % 1;
    return {
      ...REST,
      rot: keyframes(q, [
        [0, 0],
        [0.4, -22],
        [0.6, -22],
        [1, 0],
      ]),
    };
  };
}

export const ORDER_LOOPS = {
  shake,
  shakeArc,
  ticketFeed,
  noteSway,
} as const;
