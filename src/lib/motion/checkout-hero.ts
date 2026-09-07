// The checkout heroes (components/brand/CheckoutHero): the order on the
// counter for pickup, the order packed at the door for delivery. Pure
// phase→frame maths for their moving parts; which cups they draw is
// lib/menu/order-cups.
//
// Mirror of the App's lib/motion/checkout-hero.ts. Keep the two in lockstep.

import { REST, hump, inOut, keyframes, type Frame } from "@/lib/motion/category-art";

/* ------------------------------- pickup ------------------------------- */

/** A lucky cat's paw: up, hold, down. */
export function beckon(p: number): Frame {
  return {
    ...REST,
    rot: keyframes(p, [
      [0, 0],
      [0.4, -22],
      [0.6, -22],
      [1, 0],
    ]),
  };
}
/** The service bell: pressed and springing back at the top of the cycle. */
export function ding(p: number): Frame {
  return {
    ...REST,
    sy: keyframes(p, [
      [0, 1],
      [0.04, 0.82],
      [0.09, 1.08],
      [0.14, 1],
      [1, 1],
    ]),
  };
}
/** The bell's sound, one arc a side, spreading out and fading (side −1 / +1). */
function ring(p: number, side: number): Frame {
  if (p < 0.02 || p > 0.26) return { ...REST, opacity: 0 };
  const t = (p - 0.02) / 0.24;
  return { ...REST, tx: side * 12 * t, scale: 0.6 + 0.55 * t, opacity: inOut(t, 0.25, 0.9) };
}
export function ringLeft(p: number): Frame {
  return ring(p, -1);
}
export function ringRight(p: number): Frame {
  return ring(p, 1);
}
/** The order ticket, leaning, stirring in the air-con. */
export function flutter(p: number): Frame {
  return { ...REST, rot: -7 + 4 * hump(p) };
}
/** A potted plant: a small sway about its base. */
export function planted(p: number): Frame {
  return { ...REST, rot: -4 + 8 * hump(p) };
}

/* ------------------------------ delivery ------------------------------ */

/** A cloud drifting and coming back. */
export function drift(p: number): Frame {
  return { ...REST, tx: 26 * hump(p) };
}
/** The doorbell button, pressed at the top of the cycle. */
export function bellwave(p: number): Frame {
  return {
    ...REST,
    scale: keyframes(p, [
      [0, 1],
      [0.1, 1.12],
      [0.2, 1],
      [1, 1],
    ]),
  };
}
/** A chime ring: grows and fades in the first third. */
export function chime(p: number): Frame {
  if (p > 0.3) return { ...REST, opacity: 0 };
  const t = p / 0.3;
  return {
    ...REST,
    scale: 0.5 + t,
    opacity: t < 0.33 ? (t / 0.33) * 0.9 : 0.9 * (1 - (t - 0.33) / 0.67),
  };
}

/** When the last of `n` cups has gone into the bag (phase). */
export function packEnd(n: number): number {
  return 0.06 + Math.max(0, n - 1) * 0.18 + 0.2;
}
/** The bag's lid: opens early, stays open while the cups go in, closes after the last. */
export function flapFor(n: number): (p: number) => Frame {
  const closeAt = Math.min(0.84, packEnd(n) + 0.06);
  return (p: number): Frame => ({
    ...REST,
    rot: keyframes(p, [
      [0, 0],
      [0.03, 0],
      [0.09, -42],
      [closeAt, -42],
      [closeAt + 0.1, 0],
      [1, 0],
    ]),
  });
}
/** Cup `i` of the order: appears above the bag, then lowers into it, and stays (hidden by the bag's front). */
export function packFor(i: number): (p: number) => Frame {
  const start = 0.06 + i * 0.18;
  return (p: number): Frame => {
    if (p < start) return { ...REST, ty: -52, opacity: 0 };
    const appear = Math.min(1, (p - start) / 0.06);
    const drop = Math.max(0, Math.min(1, (p - start - 0.06) / 0.14));
    const eased = drop < 0.5 ? 2 * drop * drop : 1 - Math.pow(-2 * drop + 2, 2) / 2;
    return { ...REST, ty: -52 * (1 - eased), opacity: appear };
  };
}

export const HERO_LOOPS = {
  beckon,
  ding,
  ringLeft,
  ringRight,
  flutter,
  planted,
  drift,
  bellwave,
  chime,
} as const;
export type HeroLoopName = keyof typeof HERO_LOOPS;
