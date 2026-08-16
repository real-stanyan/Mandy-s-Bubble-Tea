// How a customer order reads back to them.
//
// Pure, and in its own file, so it can be tested: the fetcher next door is
// server-only and cannot be imported by a test at all.

export type OrderStatus =
  | { known: false; reason: "signed-out" | "none" | "unavailable" }
  | {
      known: true;
      reference: string;
      placedMinutesAgo: number;
      isDelivery: boolean;
      /** Square says the order is still open and it is not marked fulfilled. */
      inProgress: boolean;
    };


/**
 * The sentence the model is given back.
 *
 * Composed here rather than handed over as fields, for the same reason the
 * staff assistant composes its own: a model that can paraphrase a number will
 * eventually invent one, and this one is about a customer's own order.
 */
export function describeOrderStatus(status: OrderStatus): string {
  if (!status.known) {
    if (status.reason === "signed-out") {
      return "You are not signed in on this device, so I cannot look your order up. Sign in and I can, or ring the shop and they will check.";
    }
    if (status.reason === "none") {
      return "I cannot see any recent order on your account.";
    }
    return "I could not check your order just now.";
  }

  const { reference, placedMinutesAgo, isDelivery, inProgress } = status;
  const when =
    placedMinutesAgo < 1
      ? "just now"
      : `${placedMinutesAgo} minute${placedMinutesAgo === 1 ? "" : "s"} ago`;

  if (!inProgress) {
    return `Order ${reference}, placed ${when}, is finished on our side.`;
  }
  if (!isDelivery) {
    return `Order ${reference} was placed ${when} and is still being made. It will be waiting at the counter.`;
  }
  // The number that answers the question the customer actually asked. Nobody
  // is looking for a driver — the shop delivers its own orders — so the wait
  // being described is the shop accepting it, not a marketplace matching one.
  return placedMinutesAgo <= 10
    ? `Order ${reference} was placed ${when}. Delivery orders are accepted within about 10 minutes of ordering, so it is still inside the normal wait. The shop delivers it itself — there is no driver to be found.`
    : `Order ${reference} was placed ${when} and is still open. That is longer than the usual 10 minutes to be accepted, so it is worth ringing the shop to check. The shop delivers it itself — there is no driver to be found.`;
}
