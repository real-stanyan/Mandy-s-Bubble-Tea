import {
  BUSINESS,
  DELIVERY,
  DELIVERABLE_POSTCODES,
  LOYALTY,
  LOYALTY_CATEGORIES,
} from "@/lib/constants";
import {
  OPEN_MIN,
  CLOSE_MIN,
  ORDER_CUTOFF_MIN,
  formatClock,
  getStoreStatus,
} from "@/lib/store-status";
import { WEEKLY_SPECIALS } from "@/lib/menu/weekly-specials";

/** Decimal Brisbane hour → "10:30"-style label. */
function hourLabel(h: number): string {
  const whole = Math.floor(h);
  const minutes = Math.round((h - whole) * 60);
  return `${whole}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Store facts for the chat system prompt — the answers the assistant is
 * allowed to give to non-menu questions. Everything here is imported from
 * the same constants the rest of the site renders, so the assistant can
 * never drift from what the delivery form or the loyalty card shows.
 *
 * Deliberately does NOT state numeric prices or fees (delivery fee bands,
 * card surcharge): the chat's core invariant is that no price reaches the
 * customer except catalog-derived numbers printed by the app, and the fee
 * schedule is better answered by checkout itself, which computes the real
 * amount for the customer's actual address and subtotal.
 */
export function buildStoreDigest(
  /** A live delivery pause, so Mandy stops offering delivery the moment the
   *  shop pauses it. Without this she keeps promising a service the order
   *  API will refuse — the same "promised what we can't deliver" failure
   *  preference-check.ts exists to stop. */
  deliveryPause: { until: string; reason: string } | null = null,
  /** Injectable for tests; production always uses the real clock. */
  now: Date = new Date(),
  /** Which client is asking. The pickup-time picker shipped on the website
   *  first, so telling an APP customer to "choose a time at checkout" is a
   *  promise their screen cannot keep — exactly the failure this digest
   *  exists to prevent. Resolved server-side from request headers
   *  (client-platform.ts), never from the body. Cache note: this splits the
   *  cached prefix into two buckets (web / app), not one per customer. */
  clientPlatform: "web" | "app" = "web",
): string {
  const specials = WEEKLY_SPECIALS.map((s) => s.name).join(", ");

  // "Are you open NOW?" — asked at 3:47am, Mandy recited the opening hours
  // and then asked what the customer wanted to drink (probe, 2026-08-17).
  // Hours alone make the reader do the clock math; this line does it for
  // her. Cache note: the store digest sits in the cached prompt prefix, and
  // this line changes it — but only twice a day (open/close boundary), not
  // per customer, which is the same cost profile as a delivery pause.
  // The pickup-time picker is a WEBSITE checkout feature today (App issue
  // #276 tracks the port). An app customer told to "choose a time at
  // checkout" would go looking for a control that isn't on their screen —
  // so they get the honest version instead: order when you're close, or
  // use the website to book the window.
  const pickupWindowFact =
    clientPlatform === "app"
      ? `- Scheduled pickup: choosing a collection time (now / 10 / 15 / 20 / 30 minutes ahead) is available on the WEBSITE checkout at ${BUSINESS.domain}, not in this app yet — never tell an app customer to pick a time at checkout, because there is no such control here. In the app, an order is started as soon as it is placed and takes about 10 minutes, so someone arriving later should either order when they are closer, or place it on the website to book the window. There is NO booking for later today, tomorrow, or a set hour anywhere, and delivery cannot be scheduled at all.`
      : `- Scheduled pickup (website checkout): a pickup order can be collected NOW or in 10 / 15 / 20 / 30 minutes — the customer picks on the checkout page, and the counter starts making the drinks a few minutes before that time so they are fresh on arrival. Arriving early is fine: the order page has an "I'm here" button that starts the drinks immediately. Options whose pickup time would fall after closing are not offered, and the furthest ahead anyone can book is 30 minutes — there is NO booking for later today, tomorrow, or "in two hours". Delivery orders cannot be scheduled at all.`;

  const status = getStoreStatus(now);
  const rightNow = status.open
    ? `- RIGHT NOW the store is OPEN (${status.nextLabel}; online ordering closes ${formatClock(ORDER_CUTOFF_MIN)}). "Are you open / can I order now?" — yes.`
    : `- RIGHT NOW the store is CLOSED — opens ${status.nextLabel}. Online ordering starts then too: the customer CANNOT place an order at this moment, so never take one "for when you open". Answer "are you open now" with this line first, then the hours.`;
  // While paused, the delivery facts are REPLACED, not annotated. A warning
  // line above "we deliver to 4211, 4214, …, daily 10:30–22:30" loses to the
  // concrete list every time — the model answered "yes, 4217 is in our
  // delivery area" with the warning right there in its own prompt
  // (2026-08-11). Contradictory context is worse than missing context.
  const deliveryFacts = deliveryPause
    ? [
        `- DELIVERY IS PAUSED RIGHT NOW (${deliveryPause.reason}) and cannot be ordered at all — not to any postcode, not at any time today until it resumes later today. There is no delivery area and no delivery hours while paused: the checkout will refuse a delivery order.`,
        `- Ordering: pickup at the store ONLY. If the customer asks about delivery, or names an address or postcode, tell them delivery is paused for system maintenance and will be back later today, and offer pickup. Never say a postcode is in range, never quote delivery hours or fees.`,
      ]
    : [
        `- Ordering: pickup at the store, or delivery to postcodes ${DELIVERABLE_POSTCODES.join(", ")} (minimum order applies; the delivery fee depends on distance and order size and is shown at checkout).`,
        `- How a delivery order is placed: exactly like pickup — choose the drinks first, then enter the address on the CHECKOUT page, which is what confirms the area and calculates the fee. Do not ask the customer which postcode they are in and do not try to map a street address to one yourself.`,
        `- Delivery hours: ${hourLabel(DELIVERY.hoursOpen)}–${hourLabel(DELIVERY.hoursClose)} Brisbane time daily.`,
        // A customer asked three times how long it takes to "find a driver"
        // and was told three times to ring the shop (16 August). Nothing here
        // said who delivers, so the last rule in this block — say you are not
        // sure — was the only one that applied, and it applied correctly. The
        // question was not unanswerable; the answer was simply absent.
        //
        // And the question has a false premise. There is no pool of drivers
        // waiting to be matched: the shop delivers its own orders. "I can't
        // see live driver availability" left that customer waiting on
        // something that does not exist.
        `- Who delivers: the shop delivers its own orders. There is no third-party driver app, no pool of drivers, and nothing to be matched with — nobody ever has to "find a driver" and there is no driver availability to check. If a customer asks how long finding a driver takes, or worries that no driver has picked their order up, correct it plainly: the shop delivers it itself.`,
        `- After a delivery order is placed: someone accepts it within about 10 minutes, and it is made and driven out from there. That 10 minutes is the answer to "how long until someone picks up my order" — give the number. It is the normal wait, not a sign anything is wrong.`,
      ];
  return `STORE FACTS
- Store: ${BUSINESS.name}, ${BUSINESS.address}. Phone ${BUSINESS.phone}. Website ${BUSINESS.domain}.
- Opening hours: ${formatClock(OPEN_MIN)}–${formatClock(CLOSE_MIN)} Brisbane time, every day.
- Online ordering closes at ${formatClock(ORDER_CUTOFF_MIN)} — the last ${(CLOSE_MIN - ORDER_CUTOFF_MIN)} minutes before closing are walk-in only, so the counter can finish the queue.
${rightNow}
${pickupWindowFact}
- Paying online: card or Apple Pay, at checkout. Whether the counter takes cash for walk-ins is not stated here — point that one question at the store phone.
- Mystery box: a prize box unlocked by a SECRET CODE we post on our Instagram (instagram.com/mandysbubbletea) — follow the account and check the latest posts for the current code. Prizes go into the customer's Rewards and apply at checkout automatically. Each code works once per customer; new codes drop on Instagram. There is NO daily free box and no other way to get one — never offer a box without a code.
- Bulk orders (10+ cups) get a tiered discount, applied AUTOMATICALLY at checkout: 10-19 cups 10% off, 20-29 cups 15% off, 30-50 cups 20% off. It replaces every other percentage promo (never stacks). Over 50 cups cannot be ordered online at all — those are arranged personally by Rick.
- Bulk flow: when someone wants 10+ cups, FIRST ask when they want the drinks and whether they need delivery. Collecting now, or within the 30-minute pickup window → build the order normally (the discount shows up at checkout by itself — never quote discounted prices in your message${clientPlatform === "app" ? "" : "; they choose the pickup time on the checkout page"}). Wanting them FURTHER ahead than that (later today, tomorrow, a set hour), or over 50 cups → do NOT build the order: get a phone or email, call record_bulk_inquiry, and say the store will be in touch to confirm drinks, timing and price.
${deliveryFacts.join("\n")}
- Pickup holding: when an order is marked Ready it waits at the counter. If nobody collects it within about 5 minutes, staff move the drinks into the fridge to keep them fresh — a customer running late just asks at the counter and gets their order. Being late never means a wasted drink, so reassure them.
- Loyalty: buy drinks from the ${LOYALTY_CATEGORIES.join("/")} categories to earn 1 star each; ${LOYALTY.starsPerReward} stars = ${LOYALTY.rewardLabel}. Stars and rewards are used at checkout.
- This week's specials (discounted on the menu): ${specials || "none right now"}.
- Anything not stated here (exact fees, stock tomorrow): say you are not sure and point the customer at the menu, the checkout page, or the store phone. Never guess.`;
}
