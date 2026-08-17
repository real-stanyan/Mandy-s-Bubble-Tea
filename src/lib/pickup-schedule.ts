// Scheduled pickup: the customer picks WHEN they'll collect, and the shop
// holds the cup-sticker until it's time to start making the drinks.
//
// The problem this solves is drinks made too early: a customer who orders
// from home "for in 15 minutes" used to get their order made in the first
// two, so the ice was melting before they left the driveway. The fix is a
// timing contract, not a kitchen change: staff still just make whatever
// ticket comes out of the printer — the printer simply stays quiet until
// pickup-time minus the make lead.

import { brisbaneMinutes, CLOSE_MIN } from "@/lib/store-status";

/** The offsets a customer can choose, in minutes from now. Fixed pills, not
 *  a free time picker: no "10:14pm for a 10:35 pickup" edge cases, one tap,
 *  and every option is close enough that the shop's day doesn't need a
 *  schedule view — the ticket printer's delay IS the schedule. */
export const PICKUP_OFFSET_OPTIONS = [10, 15, 20, 30] as const;

export type PickupOffset = (typeof PICKUP_OFFSET_OPTIONS)[number] | 0;

/** How long before the pickup time the sticker prints. A drink takes a few
 *  minutes to make; five gives the counter one ticket's worth of slack.
 *  Deliberately a constant, not per-order math on cup count — if rush hour
 *  proves five minutes short, change ONE number (or env it), don't invent
 *  a queue model. */
export const MAKE_LEAD_MINUTES = 5;

/**
 * Which offsets are offered right now: only those whose pickup time still
 * lands before close (10:30pm Brisbane). At 10:05pm the 30-minute option
 * would promise a 10:35 pickup to a locked shop — it disappears instead.
 * "Now" (0) is always available while ordering is open at all; the
 * ordering-window guard in /api/orders owns that gate, not this list.
 */
export function availablePickupOffsets(now: Date = new Date()): number[] {
  const minutes = brisbaneMinutes(now);
  return PICKUP_OFFSET_OPTIONS.filter((offset) => minutes + offset <= CLOSE_MIN);
}

/** Server-side check for the client-sent offset. 0 (ASAP) is always valid;
 *  anything else must be an offered pill that still fits before close —
 *  a stale tab or a hand-rolled request gets a 400, not a 10:35pm pickup. */
export function isValidPickupOffset(
  offset: number,
  now: Date = new Date(),
): offset is PickupOffset {
  if (offset === 0) return true;
  return availablePickupOffsets(now).includes(offset);
}

/**
 * Scheduled orders wear OL7xx where ASAP orders wear OL8xx, so staff can
 * tell "make later" from "make now" at a glance on the POS and on a
 * sticker that surfaced early for any reason. Stan's pick, 2026-08-16
 * (6xx was on the table first — rejected as unlucky).
 *
 * Same daily counter, relabelled leading digit — exactly the DE-prefix
 * trick delivery numbers already use, so the sequence stays unique across
 * all three series. Past 99 online orders in a day the counter walks into
 * OL9xx, which this deliberately leaves alone: a wrong-prefix number is
 * still a working number, and the day that busy has bigger problems.
 */
export function toScheduledOrderNumber(pickupNumber: string): string {
  return pickupNumber.replace(/^OL8/, "OL7");
}

/** The moment the cup sticker should print for a pickup at `pickupAt`. */
export function printDueAt(pickupAt: Date): Date {
  return new Date(pickupAt.getTime() - MAKE_LEAD_MINUTES * 60 * 1000);
}

/**
 * Brisbane wall-clock label ("5:21pm") for a moment. Brisbane is UTC+10
 * with no DST, so the offset is arithmetic — deliberately not
 * Intl.DateTimeFormat, which differs between V8 and Hermes (the same call
 * the delivery-pause copy makes).
 *
 * Lives here because three surfaces need the identical string: the pickup
 * pills, the checkout hint under them, and the confirmation card.
 */
export function brisbaneClockLabel(at: Date): string {
  const bne = new Date(at.getTime() + 10 * 60 * 60 * 1000);
  const h24 = bne.getUTCHours();
  const m = bne.getUTCMinutes();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")}${h24 < 12 ? "am" : "pm"}`;
}

/** The clock time a pickup this many minutes from `now` lands on. */
export function pickupClockLabel(offsetMinutes: number, now: Date): string {
  return brisbaneClockLabel(new Date(now.getTime() + offsetMinutes * 60 * 1000));
}
