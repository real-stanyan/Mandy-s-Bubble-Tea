import "server-only";
import { getAuthedUser } from "@/lib/auth";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { isBrisbaneToday, brisbaneClock } from "@/lib/brisbane-date";
import { getDeliveredOrderIds } from "@/lib/driver-tokens";
import { isCustomAmountOnly } from "@/lib/orders/custom-amount";

/**
 * What the check_order_status tool hands back to the model — plain English
 * prose the model rephrases in the customer's language. English on purpose:
 * the tool result is reference data, exactly like STORE FACTS, and the
 * system prompt already tells the model reference data is never a sample of
 * how to sound.
 *
 * Exists because Mandy answered "It shows it's ready" by inventing an order
 * ("it'll be waiting at the counter for you", 2026-08-16) — she had no way
 * to look, so she guessed. Every branch here therefore spells out what the
 * model may claim and what it must not: the difference between "your order
 * IS ready" and "I can't see your order from here" is the whole point of
 * the tool.
 *
 * Same status model as /api/orders/history (the account page): paid filter
 * via netAmountDueMoney, fulfillment state PREPARED = Ready, self-delivery
 * completion comes from the driver app's delivered marks, not Square state.
 * Only TODAY's orders (Brisbane) are reported — "is my order ready" is
 * always about the drink being made right now, and last week's completed
 * orders would only invite the model to talk about the wrong one.
 *
 * Never throws: a lookup failure must degrade to an honest "I can't check
 * right now", not 500 the chat turn.
 */
export async function lookupOrderStatusForChat(request: Request): Promise<string> {
  const signedOut =
    "The customer is NOT signed in, so their orders cannot be looked up from here. " +
    "Say honestly that you cannot see their order from the chat. Do NOT claim the order is ready or waiting. " +
    "Reassure them with the pickup holding policy in STORE FACTS, and suggest checking the order status " +
    "in their account page on the website or app (signing in if needed).";

  const unavailable =
    "Order lookup is unavailable right now. Say honestly that you cannot check their order at the moment. " +
    "Do NOT claim the order is ready or waiting. Reassure them with the pickup holding policy in STORE FACTS, " +
    "and point them at their account's order page or the store phone.";

  try {
    const user = await getAuthedUser(request);
    if (!user) return signedOut;
    const customerId = user.profile?.square_customer_id;
    if (!customerId) return signedOut;
    if (!SQUARE_LOCATION_ID) return unavailable;

    const response = await squareClient.orders.search({
      locationIds: [SQUARE_LOCATION_ID],
      limit: 25,
      query: {
        filter: {
          customerFilter: { customerIds: [customerId] },
          stateFilter: { states: ["OPEN", "COMPLETED", "CANCELED"] },
        },
        sort: { sortField: "CREATED_AT", sortOrder: "DESC" },
      },
    });

    // Today's paid orders only — same "was this paid?" signal as the
    // account page (netAmountDueMoney handles the loyalty-covers-everything
    // case where tenders stay empty), plus the custom-amount filter so a
    // staff card test never shows up as "your order".
    const todays = (response.orders ?? []).filter((o) => {
      if (!isBrisbaneToday(o.createdAt ?? null)) return false;
      if (isCustomAmountOnly(o)) return false;
      if (o.state === "CANCELED") return true;
      const total = o.totalMoney?.amount ?? 0n;
      const due = o.netAmountDueMoney?.amount ?? total;
      return due === 0n;
    });

    if (todays.length === 0) {
      return (
        "This customer is signed in but has NO orders placed today. Do not invent one. " +
        "If they believe they ordered, it may have been under a different account or by phone — " +
        "point them at their account's order page or the store phone."
      );
    }

    const deliveryIds = todays
      .filter(
        (o) =>
          o.metadata?.fulfillment_type === "DELIVERY" ||
          o.fulfillments?.[0]?.type === "DELIVERY",
      )
      .map((o) => o.id)
      .filter((id): id is string => Boolean(id));
    const deliveredIds = await getDeliveredOrderIds(deliveryIds).catch(
      () => new Set<string>(),
    );

    const lines = todays.slice(0, 3).map((o) => {
      const fulfillment = o.fulfillments?.[0];
      const isDelivery =
        o.metadata?.fulfillment_type === "DELIVERY" ||
        fulfillment?.type === "DELIVERY";

      let status: string;
      if (o.state === "CANCELED") {
        status = "CANCELLED";
      } else if (isDelivery) {
        status = deliveredIds.has(o.id ?? "")
          ? "DELIVERED"
          : fulfillment?.state === "PREPARED"
            ? "prepared and on its way"
            : "being prepared for delivery";
      } else if (fulfillment?.state === "COMPLETED") {
        status = "already picked up";
      } else if (fulfillment?.state === "PREPARED") {
        status = "READY — waiting at the counter";
      } else {
        status = "still being made";
      }

      const ref = o.referenceId ?? o.ticketName ?? null;
      const items = (o.lineItems ?? [])
        .map((li) => `${li.quantity ?? "1"}x ${li.name ?? "item"}`)
        .join(", ");
      const placed = o.createdAt ? ` — placed ${brisbaneClock(o.createdAt)}` : "";
      return `- ${ref ? `Order #${ref}` : "Order"}${placed} — ${items || "no line detail"} — status: ${status}`;
    });

    return (
      `Today's orders for this signed-in customer (${todays.length} total, newest first):\n` +
      lines.join("\n") +
      "\nAnswer from these facts ONLY — never invent an order or a status. " +
      "If an order is READY and they are running late, reassure them with the pickup holding policy in STORE FACTS."
    );
  } catch (err) {
    console.error(
      "[chat] order status lookup failed; telling the model it is unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return unavailable;
  }
}
