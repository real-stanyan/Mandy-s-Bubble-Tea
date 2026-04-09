import { NextResponse } from "next/server";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { serializeSquareResponse } from "@/lib/utils";

// Order history for the account page. Searches Square orders by
// customerId, newest first. Returns a compact projection of each order
// (we don't need the full Square payload here — the confirmation page
// is where we render the fine details).

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
    const response = await squareClient.orders.search({
      locationIds: [SQUARE_LOCATION_ID],
      limit: 25,
      query: {
        filter: {
          customerFilter: { customerIds: [customerId] },
        },
        sort: {
          sortField: "CREATED_AT",
          sortOrder: "DESC",
        },
      },
    });

    const orders = (response.orders ?? []).map((order) => ({
      id: order.id,
      createdAt: order.createdAt ?? null,
      state: order.state ?? null,
      totalCents: order.totalMoney?.amount?.toString() ?? "0",
      itemSummary: (order.lineItems ?? [])
        .map((li) => `${li.quantity}× ${li.name ?? "Item"}`)
        .join(", "),
      lineCount: order.lineItems?.length ?? 0,
    }));

    return NextResponse.json({
      ok: true,
      orders: serializeSquareResponse(orders),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
