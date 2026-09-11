// Swiping between the tab pages on the phone — Home slides out under the
// thumb and a pane of frosted glass comes in for Menu, then Menu itself
// (Rick, 2026-09-11). The App does this with four pages side by side; the
// site cannot, each tab being its own route, so it drags the page it has,
// meets it with a frosted pane wearing the next tab's mark, and swaps the
// real page in behind the glass once the route has streamed. The
// arithmetic of that gesture lives here, pure, so it is testable; the DOM
// work is in components/layout/SwipeNav.

/** Movement smaller than this has no direction yet. */
export const LOCK_DISTANCE = 12;
/** Sideways has to beat up-and-down by this much to be a swipe; anything
 *  closer to the diagonal is the page being read. */
export const LOCK_RATIO = 1.25;
/** Fraction of the viewport a slow drag must cover to turn the page. */
export const COMMIT_FRACTION = 0.32;
/** A flick faster than this (px per ms) turns the page whatever the distance. */
export const FLICK_VELOCITY = 0.55;
/** A flick still has to have moved this far, or a tap with a tremor turns pages. */
export const FLICK_MIN_DISTANCE = 24;
/** How far past the first or last tab the page gives before the rubber goes stiff. */
export const OVERDRAG_PX = 72;
/** How far the frosted pane rides over the page at the join — the width of
 *  the feathered, blurred seam. */
export const SEAM_OVERLAP = 56;
/** The seam grows to its full overlap over this much drag, so the glass
 *  never appears as a ready-made strip on the first moved pixel. */
export const SEAM_GROW_PX = 120;

/** Turning the page after a release. */
export const OUT_MS = 300;
/** The glass dissolving once the new page is in. */
export const IN_MS = 260;
/** Going back to where the drag started. */
export const CANCEL_MS = 260;
/** If the route has not arrived by then, the glass lifts anyway rather than
 *  hold the customer behind it. */
export const ARRIVE_TIMEOUT_MS = 4000;

export type Axis = "none" | "horizontal" | "vertical";

/** Decide what a touch is doing once it has moved. */
export function lockAxis(dx: number, dy: number): Axis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < LOCK_DISTANCE && ay < LOCK_DISTANCE) return "none";
  return ax > ay * LOCK_RATIO ? "horizontal" : "vertical";
}

/** Resistance past an end: follows the finger 1:1 at first and never gets
 *  further than OVERDRAG_PX. */
export function overdrag(px: number): number {
  return (OVERDRAG_PX * px) / (px + OVERDRAG_PX);
}

/** Where the page sits for a finger displacement, given whether there is a
 *  tab in that direction to reach. */
export function dragOffset(dx: number, hasNeighbour: boolean): number {
  if (hasNeighbour) return dx;
  return dx < 0 ? -overdrag(-dx) : overdrag(dx);
}

/** The tab a drag of `dx` is heading for, or null past either end. */
export function neighbourIndex(index: number, dx: number, count: number): number | null {
  if (dx < 0) return index + 1 < count ? index + 1 : null;
  if (dx > 0) return index - 1 >= 0 ? index - 1 : null;
  return null;
}

/** Whether a release turns the page: far enough, or a flick that agrees
 *  with the distance travelled. */
export function shouldCommit(dx: number, vx: number, width: number): boolean {
  const ax = Math.abs(dx);
  if (ax >= width * COMMIT_FRACTION) return true;
  const sameWay = Math.sign(vx) === Math.sign(dx);
  return sameWay && Math.abs(vx) >= FLICK_VELOCITY && ax >= FLICK_MIN_DISTANCE;
}

/** How far the glass rides over the page at this point of the drag. */
export function seamOverlap(offset: number): number {
  const p = Math.min(1, Math.abs(offset) / SEAM_GROW_PX);
  return SEAM_OVERLAP * p;
}

/** Where the frosted pane goes for a page offset: its leading edge meets
 *  the page and rides `seamOverlap` over it. The pane is laid out
 *  SEAM_OVERLAP wider than the viewport on both sides, so at a full turn
 *  its feathered edge has left the screen. `dir` is 1 when the next tab
 *  comes from the right, -1 when the previous one comes from the left. */
export function ghostX(offset: number, dir: 1 | -1, width: number): number {
  const overlap = seamOverlap(offset);
  if (dir === 1) return width + offset - overlap + SEAM_OVERLAP;
  return offset + overlap - width - SEAM_OVERLAP;
}

/** The tab index, fractional, the pill window should sit on mid-drag. */
export function windowIndex(index: number, offset: number, width: number, count: number): number {
  const raw = index - offset / Math.max(1, width);
  return Math.min(count - 1, Math.max(0, raw));
}

/** Velocity smoothing: the latest sample weighed against what came before,
 *  so one jittery event at the lift does not decide the turn. */
export function blendVelocity(previous: number, sample: number): number {
  return previous * 0.6 + sample * 0.4;
}

/** The pill listens for this to move its window with the finger during a
 *  drag and on to the new tab the moment the page turns, ahead of the
 *  route. `index` may be fractional while `live`; null once everything is
 *  back at rest. */
export const TAB_DRAG_EVENT = "mbt:tab-drag";
export type TabDragDetail = { index: number | null; live: boolean };
