import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { BUSINESS } from "@/lib/constants";
import { serializeSquareResponse } from "@/lib/utils";
import { nextOnlineOrderNumber, getWelcomeDiscountStatus } from "@/lib/supabase";

// Creates a Square order from the client cart. Prices are trusted to
// Square via catalogObjectId references — we send variation IDs (and
// modifier IDs) rather than loose amounts so Square recomputes pricing
// against the current catalog. This also means tax/loyalty rules
// configured in the Square Dashboard apply automatically.

type ClientLineModifier = {
  id: string; // catalog modifier id
  name?: string;
};

type ClientLine = {
  itemName: string;
  variationId: string; // catalog item variation id
  variationName?: string;
  modifiers: ClientLineModifier[];
  quantity: number;
};

type CreateOrderBody = {
  lines: ClientLine[];
  customerId: string;
  recipientName: string;
  recipientPhone: string; // already E.164-ish (from /api/customer flow)
  note?: string;
  applyWelcomeDiscount?: boolean;
};

function isValidBody(body: unknown): body is CreateOrderBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<CreateOrderBody>;
  return (
    Array.isArray(b.lines) &&
    b.lines.length > 0 &&
    typeof b.customerId === "string" &&
    typeof b.recipientName === "string" &&
    typeof b.recipientPhone === "string"
   );
}

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

  if (!isValidBody(body)) {
    return NextResponse.json(
       { ok: false, error: "Missing or invalid fields" },
       { status: 400 },
     );
   }

   // Basic per-line sanity check so we fail fast on bad client state.
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
  } catch (err) {
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
      const status = await getWelcomeDiscountStatus(body.customerId);
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
        customerId: body.customerId,
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
                customerId: body.customerId,
                displayName: body.recipientName,
                phoneNumber: body.recipientPhone,
              },
              note: [pickupNumber, body.note].filter(Boolean).join(" — "),
            },
          },
        ],
        // Metadata helps us trace orders back to this web app in the
        // Square Dashboard and is safe to include (no PII).
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

     // Return the server-computed total as a plain string so the client
     // can feed it into payments.verifyBuyer() for SCA/3DS.
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
