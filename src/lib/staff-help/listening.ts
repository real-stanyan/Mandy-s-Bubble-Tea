/**
 * When a spoken report counts as finished.
 *
 * The browser's own answer is "the first pause", which is wrong for this job:
 * describing a shop problem is full of pauses — "冰箱坏了…就是后面那台…" — and
 * continuous recognition off, the recogniser closed on the first breath and
 * sent half a sentence.
 *
 * So the recogniser runs continuous and silence is judged here.
 */

/** How long a pause runs before we decide they have finished. Long enough to
 *  think mid-sentence; short enough that nobody waits on it. */
export const SILENCE_MS = 2500;

/** Backstop. Continuous recognition in a noisy shop can keep hearing the room
 *  and never fall silent; a microphone that never closes is a surprise and a
 *  bill. */
export const MAX_LISTEN_MS = 30_000;

/**
 * Should listening stop now?
 *
 * `lastHeardAt` is when the last result arrived, or when listening started if
 * nothing has been heard at all — a mic opened by accident against a wall of
 * shop noise still has to close on its own.
 */
export function shouldStopListening(
  now: number,
  startedAt: number,
  lastHeardAt: number,
): boolean {
  return now - lastHeardAt >= SILENCE_MS || now - startedAt >= MAX_LISTEN_MS;
}
