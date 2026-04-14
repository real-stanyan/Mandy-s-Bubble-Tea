import { NextResponse } from "next/server";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { getMenu } from "@/lib/catalog";
import { serializeSquareResponse } from "@/lib/utils";

// Order history for the account page. Searches Square orders by
// customerId, newest first. Returns a compact projection of each order
// plus enough line-item detail (variation id, modifier ids + list names,
// first-item image URL) for the app to both render thumbnails and
// reconstruct an identical cart for "Reorder".

type HistoryBody = { customerId?: unknown };

export async function POST(request: Request) {
  if (!SQUARE_LOCATION_ID) {
    return NextResponse.json(
      { ok: false, error: "SQUARE_LOCATION_ID is not set on the server" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { customerId } = (body ?? {}) as HistoryBody;
  if (typeof customerId !== "string" || !customerId) {
    return NextResponse.json(
      { ok: false, error: "customerId is required" },
      { status: 400 },
    );
  }

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
            stateFilter: { states: ["OPEN", "COMPLETED"] },
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

    // Square dashboard hides orders that never got a payment (e.g. the
    // app/web created an order but the customer bailed before Apple Pay
    // / Google Pay / card charged). Those still come back from the
    // search with state=OPEN; filter by tender presence instead of
    // state to match what the shop owner sees.
    const paidOrders = (response.orders ?? []).filter(
      (o) => (o.tenders ?? []).length > 0,
    );

    const orders = paidOrders.map((order) => {
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

      return {
        id: order.id,
        createdAt: order.createdAt ?? null,
        state: order.state ?? null,
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

    return NextResponse.json({
      ok: true,
      orders: serializeSquareResponse(orders),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
