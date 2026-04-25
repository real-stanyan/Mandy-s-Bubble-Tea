// Brisbane = UTC+10 year-round (QLD has no DST since 1992).
// Mirrors the offset trick used in lib/holiday.ts — deliberately NOT using
// Intl.DateTimeFormat (V8/Hermes inconsistency, hard to test).
import { DELIVERY } from "./constants";

function brisbaneHourDecimal(now: Date): number {
  const ms = now.getTime() + 10 * 60 * 60 * 1000;
  const d = new Date(ms);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

// Open at 11:00, close at 21:30 (close is exclusive — at 21:30 the
// shop stops accepting new delivery orders for the day).
export function isDeliveryHoursOpen(now: Date = new Date()): boolean {
  const h = brisbaneHourDecimal(now);
  return h >= DELIVERY.hoursOpen && h < DELIVERY.hoursClose;
}
