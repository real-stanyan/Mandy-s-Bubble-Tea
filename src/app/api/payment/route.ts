import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { SquareError } from "square";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { BUSINESS } from "@/lib/constants";
import { serializeSquareResponse } from "@/lib/utils";
import { findOrCreateLoyaltyAccount, accrueForOrder } from "@/lib/loyalty";
import { consumeWelcomeDiscount } from "@/lib/supabase";
import { consumeIgFollowDiscount } from "@/lib/ig-follow-discount";
import { getAuthedUser } from "@/lib/auth";
import { enqueuePrintJob } from "@/lib/print-jobs";
import { notifyOwnersPrinterAlert } from "@/lib/printer-alert";

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
  verificationToken?: string; // from payments.verifyBuyer() for SCA
  doodleIds?: Record<string, string>;
};

function isValidBody(body: unknown): body is PaymentBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<PaymentBody>;
  if (typeof b.orderId !== "string" || b.orderId.length === 0) return false;
  if (b.sourceId !== undefined && typeof b.sourceId !== "string") return false;
  if (b.doodleIds !== undefined) {
    if (typeof b.doodleIds !== "object" || b.doodleIds === null) return false;
    for (const v of Object.values(b.doodleIds)) {
      if (typeof v !== "string") return false;
    }
  }
  return true;
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
      { ok: false, error: "Sign in and complete your profile to pay" },
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
      { ok: false, error: "Missing sourceId or orderId" },
      { status: 400 },
    );
  }

  const customerId = user.profile.square_customer_id;
  const e164 = user.profile.phone_e164;

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
        customerId,
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

      // CloudPRNT (TSP100) parallel path — enqueue cup-label jobs with
      // user-selected doodleIds when present. Runs before the webhook fires
      // so user-doodle data wins on the upsert conflict (idempotent).
      if (paymentStatus === "COMPLETED" && body.doodleIds && Object.keys(body.doodleIds).length > 0) {
        try {
          const { enqueueCupLabelJobs } = await import("@/lib/cup-label/enqueue");
          const result = await enqueuePrintJob({ order, assumeSettled: true });
          let stickerNumber: string | null = null;
          if (result.queued) {
            stickerNumber = result.stickerNumber;
          } else if (result.reason === "conflict") {
            // Webhook beat us to print_jobs. Fetch the existing sticker_number so
            // user-doodle rows still get enqueued; the upsert below overrides
            // any default rows the webhook may have already written.
            const { getSupabaseAdmin } = await import("@/lib/supabase-server");
            const { data, error } = await getSupabaseAdmin()
              .from("print_jobs")
              .select("sticker_number")
              .eq("square_order_id", order.id!)
              .maybeSingle();
            if (!error && data?.sticker_number) {
              stickerNumber = data.sticker_number;
            } else {
              console.warn("[cup-label] paid-branch: print_jobs conflict but sticker_number not found", { orderId: order.id, error });
            }
          }
          if (stickerNumber) {
            await enqueueCupLabelJobs({
              order,
              stickerNumber,
              doodleIds: body.doodleIds,
              userId: user.userId,
            });
          }
        } catch (e) {
          console.error("[cup-label] paid-branch user-doodle enqueue failed (non-fatal)", e);
        }
      }
    } else {
      // Zero-total order: fully covered by a loyalty reward (or other
      // discount). Square rejects zero-amount Payment objects, so we
      // close the order via orders.pay with an empty paymentIds list
      // instead. Square accepts that because the order total (0) is
      // satisfied by the sum of payments (0).
      const payResp = await squareClient.orders.pay({
        orderId: body.orderId,
        idempotencyKey: randomUUID(),
        paymentIds: [],
      });

      // Square does not fire an order.updated webhook when an order
      // closes via orders.pay with empty paymentIds, so the normal
      // webhook → enqueuePrintJob path never runs for $0 loyalty
      // redemptions. Enqueue directly. The print_jobs table has a
      // unique constraint on square_order_id, so if a webhook ever
      // does arrive later the duplicate insert is silently swallowed.
      // Use the order returned by orders.pay (state=COMPLETED) rather
      // than re-fetching, to avoid any read-your-writes lag.
      try {
        const paidOrder = payResp.order;
        if (!paidOrder) {
          console.error("[payment] $0 orders.pay returned no order");
          void notifyOwnersPrinterAlert(
            "vercel",
            `$0 order ${body.orderId}: orders.pay returned no order, sticker NOT queued`,
          );
        } else {
          // orders.pay succeeded, so we know the order is closed even
          // though Square's returned object still shows state=OPEN and
          // no tenders. Tell enqueuePrintJob to trust us.
          const result = await enqueuePrintJob({ order: paidOrder, assumeSettled: true });
          console.log("[payment] $0 enqueue result:", JSON.stringify(result));
          if (!result.queued && result.reason !== "conflict") {
            void notifyOwnersPrinterAlert(
              "vercel",
              `$0 order ${body.orderId} NOT queued: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`,
            );
          }
          if (result.queued) {
            // CloudPRNT (TSP100) parallel path — non-blocking, must never break the legacy print_jobs flow.
            try {
              const { enqueueCupLabelJobs } = await import("@/lib/cup-label/enqueue");
              await enqueueCupLabelJobs({ order: paidOrder, stickerNumber: result.stickerNumber });
            } catch (e) {
              console.error("[cup-label] enqueue failed (non-fatal)", e);
            }
          }
        }
      } catch (printError) {
        const msg = printError instanceof Error ? printError.message : String(printError);
        console.error("[payment] inline print enqueue for $0 order failed:", msg);
        void notifyOwnersPrinterAlert(
          "vercel",
          `$0 order ${body.orderId} enqueue threw: ${msg}`,
        );
      }
    }

    // Accrue loyalty stars. Wrapped in its own try/catch so a loyalty
    // failure (no program configured, API down, etc.) never masks a
    // successful payment — stars can be adjusted manually later if
    // something goes wrong here.
    // Skip accrual when the order was fully comped by a loyalty reward
    // — otherwise the user earns a star on the drink they just spent
    // 9 stars to redeem (net cost 8 stars instead of 9). Partial
    // redemptions (reward on a multi-drink cart with $ still owing)
    // still accrue so the paid drinks earn their stars normally.
    const hasLoyaltyReward = (order.rewards?.length ?? 0) > 0;
    const skipAccrual = hasLoyaltyReward && amount === 0n;

    let loyaltyAccrued = false;
    if (!skipAccrual) {
      try {
        const account = await findOrCreateLoyaltyAccount(customerId, e164);
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

    // Consume the welcome discount if this order had one applied AND the
    // payment actually went through. A flaky network or a non-throwing
    // failure status from Square (e.g. payment.status === "FAILED") must
    // not burn the customer's discount — they didn't pay anything.
    //
    // Settled = card charge returned status COMPLETED, OR this was a $0
    // order closed via orders.pay (which doesn't throw if it fails — but
    // if it had thrown we'd already be in the outer catch).
    let welcomeDiscountConsumedCount = 0;
    let welcomeDrinksRemaining: number | null = null;
    const paymentSettled =
      amount > 0n ? paymentStatus === "COMPLETED" : true;
    const hadWelcomeDiscount = (order.discounts ?? []).some(
      (d) => d.uid === "welcome-discount",
    );
    if (paymentSettled && hadWelcomeDiscount) {
      const rawCovered = order.metadata?.welcomeDiscountDrinksCovered;
      const parsedCovered = rawCovered ? parseInt(rawCovered, 10) : 0;
      const coveredCount =
        Number.isFinite(parsedCovered) && parsedCovered > 0 ? parsedCovered : 0;
      if (coveredCount > 0) {
        const result = await consumeWelcomeDiscount(
          customerId,
          body.orderId,
          coveredCount,
        );
        welcomeDiscountConsumedCount = result.consumedCount;
        welcomeDrinksRemaining = result.drinksRemaining;
      }
    }
    if (amount > 0n && !paymentSettled) {
      console.warn(
        `[payment] payment ${paymentId} did not settle (status=${paymentStatus}); welcome discount preserved`,
      );
    }

    let igFollowDiscountConsumedCount = 0;
    let igFollowDrinksRemaining: number | null = null;
    const hadIgFollowDiscount = (order.discounts ?? []).some(
      (d) => d.uid === "ig-follow-discount",
    );
    if (paymentSettled && hadIgFollowDiscount) {
      const rawCovered = order.metadata?.igFollowDiscountDrinksCovered;
      const parsedCovered = rawCovered ? parseInt(rawCovered, 10) : 0;
      const coveredCount =
        Number.isFinite(parsedCovered) && parsedCovered > 0 ? parsedCovered : 0;
      if (coveredCount > 0) {
        const result = await consumeIgFollowDiscount(
          customerId,
          body.orderId,
          coveredCount,
        );
        igFollowDiscountConsumedCount = result.consumedCount;
        igFollowDrinksRemaining = result.drinksRemaining;
      }
    }
    if (amount > 0n && !paymentSettled && hadIgFollowDiscount) {
      console.warn(
        `[payment] payment ${paymentId} did not settle (status=${paymentStatus}); ig-follow discount preserved`,
      );
    }

    return NextResponse.json({
      ok: true,
      paymentId,
      status: paymentStatus,
      loyaltyAccrued,
      welcomeDiscountConsumedCount,
      welcomeDrinksRemaining,
      // Preserve the old boolean flag so existing clients still have a truthy
      // signal to refresh auth. They can upgrade to the count at their own pace.
      welcomeDiscountConsumed: welcomeDiscountConsumedCount > 0,
      igFollowDiscountConsumed: igFollowDiscountConsumedCount > 0,
      igFollowDrinksRemaining,
      payment: paymentForResponse,
    });
  } catch (error) {
    console.error("[payment] error:", error instanceof Error ? error.message : error);
    const message = friendlyPaymentError(error);
    const status = error instanceof SquareError ? 400 : 502;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
