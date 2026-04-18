import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { BUSINESS } from "@/lib/constants";
import { serializeSquareResponse } from "@/lib/utils";
import { nextOnlineOrderNumber, getWelcomeDiscountStatus } from "@/lib/supabase";
import { getAuthedUser } from "@/lib/auth";

// Creates a Square order from the client cart. Identity is derived
// entirely from the Supabase session — the client does NOT send a
// customerId or phone. Prices are trusted to Square via
// catalogObjectId references so Square recomputes pricing against the
// current catalog. This also means tax/loyalty rules configured in the
// Square Dashboard apply automatically.

type ClientLineModifier = {
  id: string;
  name?: string;
};

type ClientLine = {
  itemName: string;
  variationId: string;
  variationName?: string;
  modifiers: ClientLineModifier[];
  quantity: number;
};

type CreateOrderBody = {
  lines: ClientLine[];
  note?: string;
  applyWelcomeDiscount?: boolean;
};

function isValidBody(body: unknown): body is CreateOrderBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<CreateOrderBody>;
  return Array.isArray(b.lines) && b.lines.length > 0;
}

export async function POST(request: Request) {
  if (!SQUARE_LOCATION_ID) {
    return NextResponse.json(
      { ok: false, error: "SQUARE_LOCATION_ID is not set on the server" },
      { status: 500 },
    );
  }

  const user = await getAuthedUser(request);
  if (!user?.profile?.square_customer_id || !user.profile.phone_e164) {
    return NextResponse.json(
      { ok: false, error: "Sign in and complete your profile to place an order" },
      { status: 401 },
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

  if (!isValidBody(body)) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid fields" },
      { status: 400 },
    );
  }

  for (const line of body.lines) {
    if (
      !line.variationId ||
      typeof line.quantity !== "number" ||
      line.quantity < 1
    ) {
      return NextResponse.json(
        { ok: false, error: "Invalid line item" },
        { status: 400 },
      );
    }
  }

  const customerId = user.profile.square_customer_id;
  const recipientPhone = user.profile.phone_e164;
  const recipientName = [user.profile.first_name, user.profile.last_name]
    .filter(Boolean)
    .join(" ")
    .trim() || "Customer";

  const lineItems = body.lines.map((line) => ({
    quantity: String(line.quantity),
    catalogObjectId: line.variationId,
    modifiers: line.modifiers.map((m) => ({
      catalogObjectId: m.id,
    })),
  }));

  // Pickup ASAP — pickupAt is required by Square even for ASAP orders,
  // so we use "now" as a reasonable approximation.
  const pickupAt = new Date().toISOString();

  // Daily online order number (OL800, OL801, …) shown to the customer
  // on the confirmation page AND written to Square's ticketName so
  // staff see the same number on the POS / Dashboard / kitchen printer.
  let pickupNumber: string;
  try {
    pickupNumber = await nextOnlineOrderNumber();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to generate order number" },
      { status: 500 },
    );
  }

  try {
    // Server-verify welcome discount before attaching it. Client is NOT
    // trusted — a request with applyWelcomeDiscount:true but no unused
    // row in Supabase is silently treated as "no discount".
    let welcomeDiscounts:
      | Array<{ uid: string; name: string; percentage: string; scope: "ORDER" }>
      | undefined;
    if (body.applyWelcomeDiscount) {
      const status = await getWelcomeDiscountStatus(customerId);
      if (status.available) {
        welcomeDiscounts = [
          {
            uid: "welcome-discount",
            name: "Welcome 30% Off",
            percentage: String(status.percentage || 30),
            scope: "ORDER",
          },
        ];
      }
    }

    // Note: loyalty rewards are NOT attached here. Square's order
    // create request has no loyaltyRewards field — the discount is
    // applied by calling CreateLoyaltyReward with this orderId
    // AFTER the order exists. The checkout flow does that step
    // right after this route returns.
    const response = await squareClient.orders.create({
      idempotencyKey: randomUUID(),
      order: {
        locationId: SQUARE_LOCATION_ID,
        customerId,
        referenceId: pickupNumber,
        ticketName: pickupNumber,
        lineItems,
        discounts: welcomeDiscounts,
        fulfillments: [
          {
            type: "PICKUP",
            state: "PROPOSED",
            pickupDetails: {
              scheduleType: "ASAP",
              pickupAt,
              recipient: {
                customerId,
                displayName: recipientName,
                phoneNumber: recipientPhone,
              },
              note: [pickupNumber, body.note].filter(Boolean).join(" — "),
            },
          },
        ],
        metadata: {
          source: "web",
          site: BUSINESS.domain,
        },
      },
    });

    const orderId = response.order?.id;
    if (!orderId) {
      return NextResponse.json(
        { ok: false, error: "Square did not return an order id" },
        { status: 502 },
      );
    }

    const amountCents = response.order?.totalMoney?.amount?.toString() ?? "0";

    return NextResponse.json({
      ok: true,
      orderId,
      amountCents,
      order: serializeSquareResponse(response.order),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
