import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { BUSINESS } from "@/lib/constants";
import { serializeSquareResponse } from "@/lib/utils";
import { findOrCreateLoyaltyAccount, accrueForOrder } from "@/lib/loyalty";
import { normalizeAuPhone } from "@/lib/phone";

// Takes a tokenized payment source from the Web Payments SDK and
// charges it against a previously-created Square order. The server
// re-reads the order's total so clients can't influence the charged
// amount — `amountCents` from the client is ignored, it only exists
// for client-side UX (matching paymentRequest.total for wallet flows).

type PaymentBody = {
  sourceId: string;
  orderId: string;
  customerId?: string;
  /** Phone in any format — needed for loyalty account lookup. */
  phone?: string;
  verificationToken?: string; // from payments.verifyBuyer() for SCA
};

function isValidBody(body: unknown): body is PaymentBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<PaymentBody>;
  return (
    typeof b.sourceId === "string" &&
    b.sourceId.length > 0 &&
    typeof b.orderId === "string" &&
    b.orderId.length > 0
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
      { ok: false, error: "Missing sourceId or orderId" },
      { status: 400 },
    );
  }

  try {
    // Re-read the order so we charge the server-trusted total. This
    // also catches orders that were already paid or canceled.
    const orderResponse = await squareClient.orders.get({
      orderId: body.orderId,
    });
    const order = orderResponse.order;
    if (!order) {
      return NextResponse.json(
        { ok: false, error: "Order not found" },
        { status: 404 },
      );
    }

    const amount = order.totalMoney?.amount;
    if (!amount || amount <= 0n) {
      return NextResponse.json(
        { ok: false, error: "Order has no chargeable amount" },
        { status: 400 },
      );
    }

    const payment = await squareClient.payments.create({
      sourceId: body.sourceId,
      idempotencyKey: randomUUID(),
      amountMoney: {
        amount,
        currency: BUSINESS.currency,
      },
      orderId: body.orderId,
      customerId: body.customerId,
      locationId: SQUARE_LOCATION_ID,
      autocomplete: true,
      verificationToken: body.verificationToken,
    });

    const paymentId = payment.payment?.id;
    if (!paymentId) {
      return NextResponse.json(
        { ok: false, error: "Square did not return a payment id" },
        { status: 502 },
      );
    }

    // Accrue loyalty stars. Wrapped in its own try/catch so a loyalty
    // failure (no program configured, API down, etc.) never masks a
    // successful payment — stars can be adjusted manually later if
    // something goes wrong here.
    let loyaltyAccrued = false;
    if (body.customerId && body.phone) {
      const e164 = normalizeAuPhone(body.phone);
      if (e164) {
        try {
          const account = await findOrCreateLoyaltyAccount(
            body.customerId,
            e164,
          );
          await accrueForOrder(account.accountId, body.orderId);
          loyaltyAccrued = true;
        } catch (loyaltyError) {
          // Log server-side and continue — payment already succeeded.
          console.error(
            "[payment] loyalty accrual failed:",
            loyaltyError instanceof Error
              ? loyaltyError.message
              : loyaltyError,
          );
        }
      }
    }

    return NextResponse.json({
      ok: true,
      paymentId,
      status: payment.payment?.status,
      loyaltyAccrued,
      payment: serializeSquareResponse(payment.payment),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
