import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { BUSINESS } from "@/lib/constants";
import { serializeSquareResponse } from "@/lib/utils";

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
  loyaltyRewardId?: string; // Optional loyalty reward to apply
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

  try {
      // Build the order body
    const orderBody: any = {
      locationId: SQUARE_LOCATION_ID,
      customerId: body.customerId,
      lineItems,
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
            note: body.note || undefined,
            },
          },
        ],
        // Metadata helps us trace orders back to this web app in the
        // Square Dashboard and is safe to include (no PII).
      metadata: {
        source: "web",
        site: BUSINESS.domain,
        },
      };

      // Attach loyalty reward if provided
    if (body.loyaltyRewardId) {
      orderBody.loyaltyRewards = [{
        loyaltyRewardId: body.loyaltyRewardId,
        redemptionType: "LOYALTY",
        }];
      }

    const response = await squareClient.orders.create({
      idempotencyKey: randomUUID(),
      order: orderBody,
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
