// The bottom dock (SiteTabBar + BagPill): the floating tab pill and, while
// the bag holds anything, the bag capsule beside it — one row, one height,
// one radius, one lift. The App's dock (lib/motion/cart-dock over there),
// with the choreography left to CSS: the capsule's width transitions from
// nothing to its size and the pill flexes to whatever is left. What the
// browser cannot work out for itself is how wide the capsule will be —
// a width of `auto` does not transition — so that is computed here from
// the total it shows, the same arithmetic as the App's, and set as the
// --bag-w custom property.

/** Between the pill and the capsule. */
export const DOCK_GAP = 10;
/** The capsule's own padding, the bag glyph, and the gap to the total. */
export const CAPSULE_PAD = 16;
export const CAPSULE_BAG = 20;
export const CAPSULE_TEXT_GAP = 10;
/** JetBrains Mono at 14px: 0.6em advance. The total is set in it. */
export const MONO_CH = 8.4;

/** How wide the capsule is for a total set as `label`. */
export function capsuleWidth(label: string): number {
  return CAPSULE_PAD * 2 + CAPSULE_BAG + CAPSULE_TEXT_GAP + Math.ceil(label.length * MONO_CH);
}
