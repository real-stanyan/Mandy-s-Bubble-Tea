import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { SquareError } from "square";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { BUSINESS } from "@/lib/constants";
import { serializeSquareResponse } from "@/lib/utils";
import { findOrCreateLoyaltyAccount, accrueForOrder } from "@/lib/loyalty";
import { normalizeAuPhone } from "@/lib/phone";
import { consumeWelcomeDiscount } from "@/lib/supabase";

const FRIENDLY_PAYMENT_ERRORS: Record<string, string> = {
  INSUFFICIENT_FUNDS:
    "Your card was declined due to insufficient funds. Please try another card.",
  CARD_DECLINED:
    "Your card was declined. Please try another card or contact your bank.",
  CVV_FAILURE:
    "The CVV code you entered is incorrect. Please check and try again.",
  INVALID_EXPIRATION:
    "The expiration date on your card is invalid. Please check and try again.",
  ADDRESS_VERIFICATION_FAILURE:
    "Address verification failed. Please check your billing address.",
  GENERIC_DECLINE:
    "Your card was declined. Please try another payment method.",
  CARD_EXPIRED:
    "Your card has expired. Please use a different card.",
  CARD_NOT_SUPPORTED:
    "This card type is not supported. Please try another card.",
  INVALID_CARD:
    "The card details are invalid. Please check and try again.",
  ALLOWABLE_PIN_TRIES_EXCEEDED:
    "Too many PIN attempts. Please try another card.",
  CARD_DECLINED_VERIFICATION_REQUIRED:
    "Additional verification is required. Please try again.",
};

function friendlyPaymentError(error: unknown): string {
  if (error instanceof SquareError && error.errors?.length) {
    const first = error.errors[0];
    const code = first.code as string;
    if (code && FRIENDLY_PAYMENT_ERRORS[code]) {
      return FRIENDLY_PAYMENT_ERRORS[code];
    }
    if (first.detail) {
      return first.detail;
    }
  }
  if (error instanceof Error) return error.message;
  return "Payment failed. Please try again.";
}

// Takes a tokenized payment source from the Web Payments SDK and
// charges it against a previously-created Square order. The server
// re-reads the order's total so clients can't influence the charged
// amount — `amountCents` from the client is ignored, it only exists
// for client-side UX (matching paymentRequest.total for wallet flows).

type PaymentBody = {
  /**
   * Card nonce from the Web Payments SDK. Optional because a fully
   * discounted order (e.g. a free drink loyalty reward covering the
   * whole cart) has nothing to charge — the route closes the order
   * via orders.pay with empty paymentIds instead.
   */
  sourceId?: string;
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
    typeof b.orderId === "string" &&
    b.orderId.length > 0 &&
    (b.sourceId === undefined || typeof b.sourceId === "string")
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

    const amount = order.totalMoney?.amount ?? 0n;
    let paymentId: string | null = null;
    let paymentStatus: string | null = null;
    let paymentForResponse: unknown = null;

    if (amount > 0n) {
      // Standard paid order. Require a card nonce and run the card
      // charge through payments.create.
      if (!body.sourceId) {
        return NextResponse.json(
          { ok: false, error: "Missing sourceId for a non-zero order" },
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

      const id = payment.payment?.id;
      if (!id) {
        return NextResponse.json(
          { ok: false, error: "Square did not return a payment id" },
          { status: 502 },
        );
      }
      paymentId = id;
      paymentStatus = payment.payment?.status ?? null;
      paymentForResponse = serializeSquareResponse(payment.payment);
    } else {
      // Zero-total order: fully covered by a loyalty reward (or other
      // discount). Square rejects zero-amount Payment objects, so we
      // close the order via orders.pay with an empty paymentIds list
      // instead. Square accepts that because the order total (0) is
      // satisfied by the sum of payments (0).
      await squareClient.orders.pay({
        orderId: body.orderId,
        idempotencyKey: randomUUID(),
        paymentIds: [],
      });
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

    // Consume the welcome discount if this order had one applied.
    // We inspect the order we already fetched (orderResponse.order.discounts)
    // instead of trusting the client, so this runs for every paid order
    // whose Square order carries the "welcome-discount" uid.
    let welcomeDiscountConsumed = false;
    const hadWelcomeDiscount = (order.discounts ?? []).some(
      (d) => d.uid === "welcome-discount",
    );
    if (hadWelcomeDiscount && body.customerId) {
      welcomeDiscountConsumed = await consumeWelcomeDiscount(
        body.customerId,
        body.orderId,
      );
    }

    return NextResponse.json({
      ok: true,
      paymentId,
      status: paymentStatus,
      loyaltyAccrued,
      welcomeDiscountConsumed,
      payment: paymentForResponse,
    });
  } catch (error) {
    console.error("[payment] error:", error instanceof Error ? error.message : error);
    const message = friendlyPaymentError(error);
    const status = error instanceof SquareError ? 400 : 502;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
