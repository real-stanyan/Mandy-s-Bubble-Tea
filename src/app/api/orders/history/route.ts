import { NextResponse } from "next/server";
import { isCustomAmountOnly } from "@/lib/orders/custom-amount";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { getMenu } from "@/lib/catalog";
import { serializeSquareResponse } from "@/lib/utils";
import { getAuthedUser } from "@/lib/auth";
import { getDeliveredOrderIds } from "@/lib/driver-tokens";
import { isBrisbaneToday } from "@/lib/brisbane-date";
import { hasAuthorizedHold } from "@/lib/orders/authorized-hold";
import { findGhostZeroOrderIds } from "@/lib/orders/ghost-zero-order";

// Order history for the account page. Customer is derived from the
// Supabase session — no body required. Searches Square orders by
// customerId, newest first. Returns a compact projection of each
// order plus enough line-item detail (variation id, modifier ids +
// list names, first-item image URL) for the app to both render
// thumbnails and reconstruct an identical cart for "Reorder".

export const dynamic = "force-dynamic";

// Canceled by either signal. Square does not cascade fulfillment CANCELED →
// order CANCELED, and a delivery release (driver Decline / 30-min sweep)
// historically only canceled the fulfillment.
function isCanceled(order: {
  state?: string | null;
  fulfillments?: { state?: string | null }[] | null;
}): boolean {
  return (
    order.state === "CANCELED" || order.fulfillments?.[0]?.state === "CANCELED"
  );
}

export async function GET(request: Request) {
  if (!SQUARE_LOCATION_ID) {
    return NextResponse.json(
      { ok: false, error: "SQUARE_LOCATION_ID is not set on the server" },
      { status: 500 },
    );
  }

  const user = await getAuthedUser(request);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Sign in to see your order history" },
      { status: 401 },
    );
  }
  // Authed but profile/square_customer_id not yet readable. This is the
  // brief race window after complete-signup where the just-upserted
  // user_profiles row hasn't propagated to the next request, or a
  // partially-onboarded user (Apple/Google session without phone link).
  // Returning 401 here paints a misleading "Sign in to see..." pill on
  // /account next to a fully-rendered AccountHeader (Kevin Jiang
  // 2026-05-08 21:53 BNE). Hand back an empty list — a brand-new
  // customer has no orders yet anyway.
  if (!user.profile?.square_customer_id) {
    return NextResponse.json(
      { ok: true, orders: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const customerId = user.profile.square_customer_id;

  try {
    const [response, menu] = await Promise.all([
      squareClient.orders.search({
        locationIds: [SQUARE_LOCATION_ID],
        limit: 25,
        query: {
          filter: {
            customerFilter: { customerIds: [customerId] },
            // Square dashboard hides DRAFT orders (abandoned carts that
            // never completed payment). Match that by only returning
            // OPEN (in-progress) and COMPLETED (fulfilled) orders.
            stateFilter: { states: ["OPEN", "COMPLETED", "CANCELED"] },
          },
          sort: {
            sortField: "CREATED_AT",
            sortOrder: "DESC",
          },
        },
      }),
      getMenu(),
    ]);

    // Build lookups from catalog: variationId → {itemId, imageUrl},
    // modifierId → listName.
    const variationLookup = new Map<
      string,
      { itemId: string; imageUrl: string | null }
    >();
    for (const items of menu.itemsBySlug.values()) {
      for (const item of items) {
        for (const v of item.variations) {
          variationLookup.set(v.id, {
            itemId: item.id,
            imageUrl: item.imageUrl,
          });
        }
      }
    }
    for (const item of menu.uncategorizedItems) {
      for (const v of item.variations) {
        variationLookup.set(v.id, {
          itemId: item.id,
          imageUrl: item.imageUrl,
        });
      }
    }
    const modifierListName = new Map<string, string>();
    for (const list of menu.modifierLists.values()) {
      for (const m of list.modifiers) {
        modifierListName.set(m.id, list.name);
      }
    }

    // Hide abandoned orders. The only reliable "was this paid?" signal
    // across all payment paths is netAmountDueMoney:
    // - Card payment: due=0, tenders present
    // - Loyalty reward covers full amount: due=0, tenders=[], state stays
    //   OPEN with closedAt=null until staff complete the fulfillment
    //   (so tenders/closedAt/state alone all miss this case)
    // - Partial loyalty + card: due=0, tenders present
    // - Delivery before a driver accepts: due > 0 but an AUTHORIZED card
    //   hold (capture happens on accept) — today-only, so a hold that never
    //   captures can't linger in history as if the order happened
    // - Abandoned cart: due > 0, tenders=[]
    // Also keep CANCELED orders so users see their full history — judged by
    // the fulfillment as well as the order: a driver Decline / no-driver
    // release voids the hold and cancels the fulfillment, but orders released
    // before 2026-09-02 were left OPEN (due > 0, VOIDED tender) and read as
    // abandoned carts here, so the customer's declined order vanished (DE852).
    const paidOrders = (response.orders ?? []).filter((o) => {
      if (isCanceled(o)) return true;
      const total = o.totalMoney?.amount ?? 0n;
      const due = o.netAmountDueMoney?.amount ?? total;
      const heldToday =
        isBrisbaneToday(o.createdAt ?? null) && hasAuthorizedHold(o);
      if (due !== 0n && !heldToday) return false;
      return !isCustomAmountOnly(o);
    });

    // A $0 order whose checkout never finished passes the filter above (due
    // 0, no tender) and is indistinguishable from a settled one in Square.
    // Our own print ledger tells them apart — see ghost-zero-order.ts.
    // OL890 (2026-09-06): three rewards pinned, nothing printed, and the app
    // showed "Received" for an order nobody was making.
    const ghostIds = await findGhostZeroOrderIds(paidOrders);
    if (ghostIds.size > 0) {
      console.warn(
        `[orders/history] hiding ghost $0 orders: ${[...ghostIds].join(",")}`,
      );
    }
    const visibleOrders = paidOrders.filter(
      (o) => !o.id || !ghostIds.has(o.id),
    );

    // Which delivery orders have actually been delivered (driver app marked
    // them so). Self-delivery orders keep Square state=OPEN forever, so this is
    // the real "done" signal for them. Failure degrades to "none delivered" —
    // the same-day cutoff below still clears stale orders.
    const deliveryOrderIds = visibleOrders
      .filter(
        (o) =>
          o.metadata?.fulfillment_type === "DELIVERY" ||
          o.fulfillments?.[0]?.type === "DELIVERY",
      )
      .map((o) => o.id)
      .filter((id): id is string => Boolean(id));
    const deliveredIds = await getDeliveredOrderIds(deliveryOrderIds).catch(
      () => new Set<string>(),
    );

    const orders = visibleOrders.map((order) => {
      const rawLines = order.lineItems ?? [];
      const lineItems = rawLines.map((li) => {
        const variationId = li.catalogObjectId ?? "";
        const lookup = variationLookup.get(variationId);
        return {
          variationId,
          itemId: lookup?.itemId ?? "",
          imageUrl: lookup?.imageUrl ?? null,
          name: li.name ?? "Item",
          variationName: li.variationName ?? "",
          quantity: Number(li.quantity ?? "1"),
          basePriceCents: li.basePriceMoney?.amount?.toString() ?? "0",
          modifiers: (li.modifiers ?? []).map((m) => ({
            id: m.catalogObjectId ?? "",
            name: m.name ?? "",
            listName: modifierListName.get(m.catalogObjectId ?? "") ?? "",
            priceCents: m.basePriceMoney?.amount?.toString() ?? "0",
          })),
        };
      });

      const firstLine = lineItems[0];

      // Staff move an order to "Ready" from the Square dashboard by
      // updating the fulfillment state to PREPARED. The order's own
      // `state` stays OPEN, so we surface the fulfillment state
      // separately and let the client promote it to "Ready" in the UI.
      // Look at the first fulfillment (PICKUP or DELIVERY) regardless of
      // type — both follow the same state lifecycle.
      const fulfillment = order.fulfillments?.[0];

      const isDelivery =
        order.metadata?.fulfillment_type === "DELIVERY" ||
        fulfillment?.type === "DELIVERY";
      // "In progress" = Square order still OPEN, placed today (Brisbane), and
      // not yet fulfilled. Square state stays OPEN indefinitely for
      // self-delivery + uncompleted pickups, so we layer two signals on top:
      //   • same-day cutoff — a previous-day OPEN order is treated as done
      //   • fulfilled — delivery: driver marked delivered; pickup: COMPLETED
      const fulfilled = isDelivery
        ? deliveredIds.has(order.id ?? "")
        : fulfillment?.state === "COMPLETED";
      const canceled = isCanceled(order);
      const active =
        order.state === "OPEN" &&
        !canceled &&
        isBrisbaneToday(order.createdAt ?? null) &&
        !fulfilled;

      return {
        id: order.id,
        referenceId: order.referenceId ?? order.ticketName ?? null,
        createdAt: order.createdAt ?? null,
        updatedAt: order.updatedAt ?? null,
        // Normalised: a canceled fulfillment reports as a CANCELED order so
        // the web list and the App (same payload) both show it as canceled
        // even for pre-fix releases that left the Square order OPEN.
        state: canceled ? "CANCELED" : (order.state ?? null),
        fulfillmentState: fulfillment?.state ?? null,
        active,
        // Scheduled pickup's chosen collection time — the App renders the
        // pickup-time card + "I'm here" button from this. Null for ASAP.
        scheduledPickupAt:
          fulfillment?.pickupDetails?.scheduleType === "SCHEDULED"
            ? (fulfillment.pickupDetails.pickupAt ?? null)
            : null,
        // Self-delivery orders carry a PICKUP fulfillment but record the truth
        // in metadata.fulfillment_type — prefer that so the UI shows "Delivery".
        fulfillmentType:
          (order.metadata?.fulfillment_type as string | undefined) ??
          fulfillment?.type ??
          null,
        totalCents: order.totalMoney?.amount?.toString() ?? "0",
        itemSummary: rawLines
          .map((li) => `${li.quantity}× ${li.name ?? "Item"}`)
          .join(", "),
        lineCount: rawLines.length,
        firstItemName: firstLine?.name ?? "",
        firstItemImageUrl: firstLine?.imageUrl ?? null,
        lineItems,
      };
    });

    return NextResponse.json(
      {
        ok: true,
        orders: serializeSquareResponse(orders),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
