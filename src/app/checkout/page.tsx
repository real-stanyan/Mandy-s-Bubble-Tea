"use client";

import Link from "next/link";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useCart,
  lineTotal,
  lineUnitPrice,
  cartSubtotal,
  type CartLine,
} from "@/store/cart";
import { formatPrice } from "@/lib/utils";
import { BRAND, LOYALTY } from "@/lib/constants";

// Checkout + payment. Uses the Square Web Payments SDK to collect a
// card token on-page, then posts { customer, order, payment } through
// our API routes. The SDK is loaded via next/script; we initialize the
// card form once it's ready and the DOM container is mounted.
//
// SDK docs: https://developer.squareup.com/docs/web-payments/overview

// Minimal shape of the Square Web Payments SDK we actually use. The
// real type lives on `window.Square`; we keep our own narrow surface
// rather than adding a full @types dependency.
type TokenizeResult = {
  status: "OK" | "Invalid" | "Cancel" | string;
  token?: string;
  errors?: { message: string }[];
};
type CardInstance = {
  attach(selector: string): Promise<void>;
  tokenize(): Promise<TokenizeResult>;
  destroy(): Promise<void>;
};
type ApplePayInstance = {
  // Apple Pay has no attach() — it uses the native payment sheet.
  tokenize(): Promise<TokenizeResult>;
};
type GooglePayInstance = {
  attach(selector: string): Promise<void>;
  tokenize(): Promise<TokenizeResult>;
  destroy(): Promise<void>;
};
type VerificationDetails = {
  amount: string; // major-unit string, e.g. "7.50"
  currencyCode: string;
  intent: "CHARGE" | "STORE";
  billingContact: {
    givenName?: string;
    familyName?: string;
    phone?: string;
    countryCode?: string;
  };
  customerInitiated: boolean;
  sellerKeyedIn: boolean;
};
type PaymentsInstance = {
  card(): Promise<CardInstance>;
  applePay(paymentRequest: unknown): Promise<ApplePayInstance>;
  googlePay(paymentRequest: unknown): Promise<GooglePayInstance>;
  paymentRequest(config: {
    countryCode: string;
    currencyCode: string;
    total: { amount: string; label: string };
  }): unknown;
  verifyBuyer(
    source: string,
    details: VerificationDetails,
  ): Promise<{ token: string }>;
};
type SquareGlobal = {
  payments(appId: string, locationId: string): PaymentsInstance;
};

declare global {
  interface Window {
    Square?: SquareGlobal;
  }
}

const SQUARE_ENV = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT ?? "sandbox";
const WEB_SDK_SRC =
  SQUARE_ENV === "production"
    ? "https://web.squarecdn.com/v1/square.js"
    : "https://sandbox.web.squarecdn.com/v1/square.js";
const SQUARE_APP_ID = process.env.NEXT_PUBLIC_SQUARE_APP_ID ?? "";
const SQUARE_LOCATION_ID =
  process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID ?? "";

export default function CheckoutPage() {
  const router = useRouter();
  const hydrated = useCart((s) => s.hydrated);
  const lines = useCart((s) => s.lines);
  const clear = useCart((s) => s.clear);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const [applePayAvailable, setApplePayAvailable] = useState(false);
  const [googlePayAvailable, setGooglePayAvailable] = useState(false);
  const walletAvailable = applePayAvailable || googlePayAvailable;
  const [payMethod, setPayMethod] = useState<"card" | "wallet">("card");

  // Loyalty reward state. We look up the buyer's star balance once
  // they've filled in name + phone (on phone blur) and offer a free
  // drink redemption if they have enough stars. The actual redeem call
  // happens at submit time so users can un-check without burning stars.
  const [loyaltyLookup, setLoyaltyLookup] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | {
        status: "ready";
        customerId: string;
        balance: number;
        starsPerReward: number;
      }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [useReward, setUseReward] = useState(false);

  const cardRef = useRef<CardInstance | null>(null);
  const applePayRef = useRef<ApplePayInstance | null>(null);
  const googlePayRef = useRef<GooglePayInstance | null>(null);
  const paymentsRef = useRef<PaymentsInstance | null>(null);

  const subtotal = useMemo(() => cartSubtotal(lines), [lines]);

  // The cheapest single-drink unit price — used as the reward discount
  // (Square's "Free Drink" reward covers the cheapest item).
  const rewardDiscount = useMemo(() => {
    if (lines.length === 0) return 0n;
    let cheapest = lineUnitPrice(lines[0]);
    for (const l of lines) {
      const up = lineUnitPrice(l);
      if (up < cheapest) cheapest = up;
    }
    return cheapest;
  }, [lines]);

  // Whether the user can redeem (enough stars).
  const canRedeem =
    loyaltyLookup.status === "ready" &&
    loyaltyLookup.starsPerReward > 0 &&
    loyaltyLookup.balance >= loyaltyLookup.starsPerReward;

  // Loyalty-derived values — declared early so effects can reference them.
  const loyaltyBalance =
    loyaltyLookup.status === "ready" ? loyaltyLookup.balance : 0;
  const loyaltyTotal =
    loyaltyLookup.status === "ready" && loyaltyLookup.starsPerReward > 0
      ? loyaltyLookup.starsPerReward
      : LOYALTY.starsPerReward;
  const starsThisOrder = lines.reduce((n, l) => n + l.quantity, 0);
  const progressPct = Math.min((loyaltyBalance / loyaltyTotal) * 100, 100);

  // When the reward fully covers the order — no payment needed.
  const canRedeemFully = canRedeem && subtotal - rewardDiscount <= 0n;

  // Auto-toggle reward when the order qualifies for a fully free checkout.
  useEffect(() => {
    setUseReward(canRedeemFully);
  }, [canRedeemFully]);

  // Auto-select wallet tab when it becomes available.
  useEffect(() => {
    if (walletAvailable) setPayMethod("wallet");
  }, [walletAvailable]);

  // Fetches the loyalty account for the current phone. Called on phone
  // blur and on mount (if a saved phone is restored from localStorage).
  // Uses the phone-only /api/customer/lookup (no create) so a typo
  // doesn't leave an empty customer record behind. If the phone isn't
  // on file yet, there's nothing to redeem — surface a friendly
  // "new customer" state.
  //
  // Takes an explicit phone arg so the on-mount effect can pass the
  // value it just restored without racing React's state update.
  async function lookupLoyalty(phoneOverride?: string) {
    const trimmedPhone = (phoneOverride ?? phone).trim();
    if (!trimmedPhone) return;
    setLoyaltyLookup({ status: "loading" });
    try {
      const customerRes = await fetch("/api/customer/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: trimmedPhone }),
      });
      const customerJson = await customerRes.json();
      if (!customerRes.ok || !customerJson.ok) {
        throw new Error(customerJson.error ?? "Customer lookup failed");
      }

      if (!customerJson.found) {
        setLoyaltyLookup({
          status: "ready",
          customerId: "",
          balance: 0,
          starsPerReward: 0,
        });
        return;
      }

      // Pre-fill the Name field from the matched Square customer,
      // but only if the user hasn't started typing. Functional
      // setState avoids clobbering in-flight keystrokes.
      const fullName = [customerJson.givenName, customerJson.familyName]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (fullName) {
        setName((current) => (current.trim() === "" ? fullName : current));
      }

      const loyaltyRes = await fetch("/api/loyalty/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerJson.customerId,
          phone: trimmedPhone,
        }),
      });
      const loyaltyJson = await loyaltyRes.json();
      if (!loyaltyRes.ok || !loyaltyJson.ok) {
        throw new Error(loyaltyJson.error ?? "Loyalty lookup failed");
      }

      setLoyaltyLookup({
        status: "ready",
        customerId: customerJson.customerId,
        balance: loyaltyJson.balance,
        starsPerReward: loyaltyJson.starsPerReward,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLoyaltyLookup({ status: "error", message });
    }
  }

  // On mount, pre-fill phone (and later name) from the saved account.
  // Same localStorage key as /account and <AccountLink />: a "signed
  // in" visitor shouldn't have to retype their details just to pay.
  // Runs once — subsequent edits to the phone field use the normal
  // onChange/onBlur path.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let storedPhone: string | null = null;
    try {
      storedPhone = window.localStorage.getItem("mbt:account:phone");
    } catch {
      return;
    }
    if (!storedPhone) return;
    setPhone(storedPhone);
    // Pass the phone explicitly so we don't race the setPhone above.
    // lookupLoyalty will populate the name field from Square as a
    // side effect when the customer is found.
    void lookupLoyalty(storedPhone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whether the payment card section is currently rendered in the DOM.
  const needsCard = !(canRedeemFully && useReward);

  // Initialize the Square card form once the SDK has loaded AND the
  // #card-container element is in the DOM. When the order is fully
  // covered by a loyalty reward the container is not rendered, so we
  // skip initialization (and tear down any existing card instance).
  useEffect(() => {
    if (!needsCard) {
      // Card section was removed — tear down any existing instance.
      cardRef.current?.destroy().catch(() => undefined);
      cardRef.current = null;
      setCardReady(false);
      return;
    }

    if (!sdkReady) return;
    if (cardRef.current) return;
    if (!SQUARE_APP_ID || !SQUARE_LOCATION_ID) {
      setError(
        "Payment setup is incomplete: missing NEXT_PUBLIC_SQUARE_APP_ID or NEXT_PUBLIC_SQUARE_LOCATION_ID.",
      );
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const square = window.Square;
        if (!square) throw new Error("Square SDK not available on window");
        const payments = square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID);
        paymentsRef.current = payments;
        const card = await payments.card();
        if (cancelled) return;
        await card.attach("#card-container");
        if (cancelled) {
          await card.destroy().catch(() => undefined);
          return;
        }
        cardRef.current = card;
        setCardReady(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Could not initialize card form: ${message}`);
      }
    })();

    return () => {
      cancelled = true;
      cardRef.current?.destroy().catch(() => undefined);
      cardRef.current = null;
    };
  }, [sdkReady, needsCard]);

  // Initialize Apple Pay. The SDK checks device/browser support
  // internally — if not available, applePay() throws and we just
  // leave the button hidden. We need the payments instance to exist
  // first (created in the card init above).
  useEffect(() => {
    if (!sdkReady || !needsCard) return;
    if (applePayRef.current) return;

    let cancelled = false;
    (async () => {
      try {
        // Wait for paymentsRef to be populated by the card init effect.
        // If it's not ready yet, the next render cycle will retry.
        const payments = paymentsRef.current;
        if (!payments) return;

        const paymentRequest = payments.paymentRequest({
          countryCode: "AU",
          currencyCode: "AUD",
          total: {
            amount: (Number(subtotal) / 100).toFixed(2),
            label: BRAND.name,
          },
        });
        const ap = await payments.applePay(paymentRequest);
        if (cancelled) return;
        // Apple Pay has no attach() — it uses the native iOS/Safari
        // payment sheet, not a DOM-rendered button.
        applePayRef.current = ap;
        setApplePayAvailable(true);
      } catch (err) {
        // Apple Pay not supported on this device/browser — expected on
        // non-Safari or when HTTPS is unavailable (localhost).
        console.info("[apple-pay]", err instanceof Error ? err.message : err);
      }
    })();

    return () => {
      cancelled = true;
      applePayRef.current = null;
      setApplePayAvailable(false);
    };
  }, [sdkReady, needsCard, cardReady, subtotal]);

  // Initialize Google Pay.
  useEffect(() => {
    if (!sdkReady || !needsCard) return;
    if (googlePayRef.current) return;

    let cancelled = false;
    (async () => {
      try {
        const payments = paymentsRef.current;
        if (!payments) return;

        const paymentRequest = payments.paymentRequest({
          countryCode: "AU",
          currencyCode: "AUD",
          total: {
            amount: (Number(subtotal) / 100).toFixed(2),
            label: BRAND.name,
          },
        });
        const gp = await payments.googlePay(paymentRequest);
        if (cancelled) {
          gp.destroy().catch(() => undefined);
          return;
        }
        await gp.attach("#google-pay-container");
        if (cancelled) {
          gp.destroy().catch(() => undefined);
          return;
        }
        googlePayRef.current = gp;
        setGooglePayAvailable(true);
      } catch (err) {
        console.info("[google-pay]", err instanceof Error ? err.message : err);
      }
    })();

    return () => {
      cancelled = true;
      googlePayRef.current?.destroy().catch(() => undefined);
      googlePayRef.current = null;
      setGooglePayAvailable(false);
    };
  }, [sdkReady, needsCard, cardReady, subtotal]);

  // Avoid SSR mismatch: render a placeholder until the cart hydrates.
  if (!hydrated) {
    return (
      <CheckoutFrame>
        <p className="text-sm text-zinc-500">Loading cart…</p>
      </CheckoutFrame>
    );
  }

  if (lines.length === 0) {
    return (
      <CheckoutFrame>
        <div className="rounded-lg border border-dashed border-black/20 p-12 text-center">
          <p className="mb-4 text-zinc-600">Your cart is empty.</p>
          <Link
            href="/menu"
            className="inline-block rounded-full px-5 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: BRAND.primaryColor }}
          >
            Browse menu
          </Link>
        </div>
      </CheckoutFrame>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (!name.trim() || !phone.trim()) {
      setError("Please enter your name and phone.");
      return;
    }
    const expectFreeOrder = canRedeemFully && useReward;
    if (!expectFreeOrder) {
      if (payMethod === "wallet") {
        if (!googlePayRef.current && !applePayRef.current) {
          setError("Wallet payment is not ready yet.");
          return;
        }
      } else if (!cardRef.current) {
        setError("Card form is not ready yet.");
        return;
      }
    }

    setSubmitting(true);
    try {
      // 0) Tokenize wallet IMMEDIATELY — must happen in the same
      // user-gesture frame or mobile browsers block the Google Pay
      // pop-up (OR_BIBED_15). Card tokenization doesn't open a
      // pop-up so it can happen later. We grab the token now and
      // use it after order creation for verifyBuyer + payment.
      let sourceToken: string | undefined;
      const expectFreeOrder2 = canRedeemFully && useReward;
      if (!expectFreeOrder2 && payMethod === "wallet") {
        const walletInstance = applePayAvailable
          ? applePayRef.current
          : googlePayRef.current;
        if (!walletInstance) throw new Error("Wallet payment is not ready.");
        const tokenResult = await walletInstance.tokenize();
        if (tokenResult.status !== "OK" || !tokenResult.token) {
          const detail =
            tokenResult.errors?.[0]?.message ??
            `Tokenization failed (${tokenResult.status})`;
          throw new Error(detail);
        }
        sourceToken = tokenResult.token;
      }

      // 1) Customer lookup/create.
      const customerRes = await fetch("/api/customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
      });
      const customerJson = await customerRes.json();
      if (!customerRes.ok || !customerJson.ok) {
        throw new Error(customerJson.error ?? "Customer lookup failed");
      }

      // 2) Create the order at full price. Loyalty discounts are
      // applied by Square AFTER the order exists — we attach the
      // reward in the next step, not here.
      const orderRes = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerJson.customerId,
          recipientName: name.trim(),
          recipientPhone: phone.trim(),
          note: note.trim() || undefined,
          lines: lines.map((l) => ({
            itemName: l.itemName,
            variationId: l.variationId,
            variationName: l.variationName,
            modifiers: l.modifiers.map((m) => ({
              id: m.id,
              name: m.name,
            })),
            quantity: l.quantity,
          })),
        }),
      });
      const orderJson = await orderRes.json();
      if (!orderRes.ok || !orderJson.ok) {
        throw new Error(orderJson.error ?? "Order creation failed");
      }

      // 3) Optionally redeem a loyalty reward against the order.
      // Square's CreateLoyaltyReward with an orderId is the ONLY
      // supported way to discount an order with a reward — there is
      // no order-level loyaltyRewards field on create. If this step
      // fails we bail out before any payment is taken; charging
      // full price after the user opted in would be a surprise.
      //
      // The redeem route returns the re-fetched order total so
      // verifyBuyer/pay both see the discounted amount.
      let amountCents: string = orderJson.amountCents;
      if (useReward && loyaltyLookup.status === "ready") {
        const redeemRes = await fetch("/api/loyalty/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId: customerJson.customerId,
            phone: phone.trim(),
            orderId: orderJson.orderId,
          }),
        });
        const redeemJson = await redeemRes.json();
        if (!redeemRes.ok || !redeemJson.ok) {
          throw new Error(redeemJson.error ?? "Could not redeem reward");
        }
        if (typeof redeemJson.updatedAmountCents === "string") {
          amountCents = redeemJson.updatedAmountCents;
        }
      }

      // 4) Tokenize card (if not wallet — wallet was tokenized in
      // step 0) + verify buyer, UNLESS the order is fully covered
      // by a loyalty reward (total 0).
      const isFreeOrder = amountCents === "0" || Number(amountCents) === 0;

      let verificationToken: string | undefined;
      if (!isFreeOrder) {
        // Tokenize card — wallet token was already obtained above.
        if (payMethod !== "wallet") {
          if (!cardRef.current) throw new Error("Card form is not ready yet.");
          const tokenResult = await cardRef.current.tokenize();
          if (tokenResult.status !== "OK" || !tokenResult.token) {
            const detail =
              tokenResult.errors?.[0]?.message ??
              `Tokenization failed (${tokenResult.status})`;
            throw new Error(detail);
          }
          sourceToken = tokenResult.token;
        }

        // SCA/3DS is mandatory in AU for ALL payment methods —
        // skipping triggers CARD_DECLINED_VERIFICATION_REQUIRED.
        // verifyBuyer must be called for cards AND digital wallets.
        if (!paymentsRef.current) {
          throw new Error("Payments SDK not initialized");
        }
        if (!sourceToken) {
          throw new Error("No payment token available");
        }
        const amountMajor = (Number(amountCents) / 100).toFixed(2);
        const [firstName, ...restName] = name.trim().split(/\s+/);
        const verification = await paymentsRef.current.verifyBuyer(
          sourceToken,
          {
            amount: amountMajor,
            currencyCode: "AUD",
            intent: "CHARGE",
            billingContact: {
              givenName: firstName,
              familyName: restName.join(" ") || undefined,
              phone: phone.trim(),
              countryCode: "AU",
            },
            customerInitiated: true,
            sellerKeyedIn: false,
          },
        );
        verificationToken = verification.token;
      }

      // 5) Finalize the order — either by charging the tokenized
      // card, or (for free orders) by closing the order with an
      // empty payment set. Same endpoint handles both.
      const paymentRes = await fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: sourceToken,
          orderId: orderJson.orderId,
          customerId: customerJson.customerId,
          phone: phone.trim(),
          verificationToken,
        }),
      });
      const paymentJson = await paymentRes.json();
      if (!paymentRes.ok || !paymentJson.ok) {
        throw new Error(paymentJson.error ?? "Payment failed");
      }

      // Success — clear cart and go to confirmation.
      clear();
      router.push(`/order-confirmation/${orderJson.orderId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setSubmitting(false);
    }
  }

  return (
    <CheckoutFrame>
      <Script
        src={WEB_SDK_SRC}
        strategy="afterInteractive"
        onReady={() => setSdkReady(true)}
      />

      <form
        onSubmit={handleSubmit}
        className="grid gap-6 sm:gap-8 lg:grid-cols-[1fr_380px]"
      >
        {/* ── Left column ── */}
        <div className="space-y-6">
          {/* Rewards Progress */}
          <section
            className="relative overflow-hidden rounded-2xl p-5"
            style={{ backgroundColor: BRAND.accentColor }}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-zinc-900">
                  Rewards Progress
                </h3>
                <p className="mt-1 text-sm text-zinc-600">
                  {loyaltyBalance > 0
                    ? `You have ${loyaltyBalance} stars. This order will earn you ${starsThisOrder} more star${starsThisOrder !== 1 ? "s" : ""}!`
                    : `This order will earn you ${starsThisOrder} star${starsThisOrder !== 1 ? "s" : ""}!`}
                </p>
              </div>
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
                style={{ backgroundColor: BRAND.primaryColor }}
              >
                <StarIcon />
              </span>
            </div>
            {/* Progress bar */}
            <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-white/60">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${progressPct}%`,
                  backgroundColor: BRAND.primaryColor,
                }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              <span>{loyaltyBalance} Stars</span>
              <span>{loyaltyTotal} Stars for Free Drink</span>
            </div>

            {/* Redeem checkbox */}
            {canRedeem && (
                <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border border-white/60 bg-white/50 p-3">
                  <input
                    type="checkbox"
                    checked={useReward}
                    onChange={(e) => setUseReward(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span
                    className="text-sm font-semibold"
                    style={{ color: BRAND.primaryColor }}
                  >
                    Redeem free drink ({loyaltyLookup.starsPerReward} stars)
                  </span>
                </label>
              )}
          </section>

          {/* Hidden phone field — auto-filled from localStorage */}
          <input type="hidden" value={phone} />

          {/* Free drink banner — shown when reward fully covers the order */}
          {canRedeemFully && useReward && (
            <section
              className="rounded-2xl border-2 p-5"
              style={{ borderColor: BRAND.primaryColor }}
            >
              <p
                className="text-center text-lg font-bold"
                style={{ color: BRAND.primaryColor }}
              >
                This drink is on us! 🎉
              </p>
              <p className="mt-1 text-center text-sm text-zinc-600">
                Your {loyaltyTotal} stars will be redeemed for a free drink — no payment needed.
              </p>

              {/* Name field — still needed for order recipient */}
              <label className="mt-4 block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Name
                </span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  required
                  className="w-full rounded-lg border border-black/15 bg-white px-4 py-3 text-sm outline-none focus:border-black/40"
                />
              </label>
            </section>
          )}

          {/* Payment Method — hidden when the reward fully covers the order */}
          {!(canRedeemFully && useReward) && (
            <>
              <section>
                <h3 className="mb-3 text-base font-bold text-zinc-900 sm:mb-4 sm:text-lg">
                  Payment Method
                </h3>

                {/* Tab buttons — wallet + card */}
                {walletAvailable && (
                  <div className="mb-4 grid grid-cols-2 gap-2 sm:mb-5 sm:gap-3">
                    <button
                      type="button"
                      onClick={() => setPayMethod("wallet")}
                      className="flex items-center justify-center gap-2 rounded-full border-2 py-3 text-sm font-semibold transition"
                      style={
                        payMethod === "wallet"
                          ? { borderColor: BRAND.primaryColor, color: BRAND.primaryColor }
                          : { borderColor: "rgba(0,0,0,0.15)", color: "#71717a" }
                      }
                    >
                      {applePayAvailable ? <><ApplePayIcon /> Apple Pay</> : <><GooglePayIcon /> Google Pay</>}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayMethod("card")}
                      className="flex items-center justify-center gap-2 rounded-full border-2 py-3 text-sm font-semibold transition"
                      style={
                        payMethod === "card"
                          ? { borderColor: BRAND.primaryColor, color: BRAND.primaryColor }
                          : { borderColor: "rgba(0,0,0,0.15)", color: "#71717a" }
                      }
                    >
                      <CardIcon />
                      Card
                    </button>
                  </div>
                )}
              </section>

              {/* Wallet panel — SDK-rendered button(s).
                  Containers stay in the DOM always so attach() survives
                  tab switches; we toggle visibility with style. */}
              <section
                className="relative rounded-2xl border border-black/10 bg-white p-5"
                style={{ display: payMethod === "wallet" && walletAvailable ? undefined : "none" }}
              >
                <label className="mb-4 block">
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Name
                  </span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                    className="w-full rounded-lg border border-black/15 bg-white px-4 py-3 text-sm outline-none focus:border-black/40"
                  />
                </label>
                {!phone && (
                  <label className="mb-4 block">
                    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                      Phone
                    </span>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(v) => {
                        setPhone(v.target.value);
                        if (loyaltyLookup.status !== "idle") {
                          setLoyaltyLookup({ status: "idle" });
                          setUseReward(false);
                        }
                      }}
                      onBlur={() => lookupLoyalty()}
                      placeholder="0404 123 456"
                      autoComplete="tel"
                      className="w-full rounded-lg border border-black/15 bg-white px-4 py-3 text-sm outline-none focus:border-black/40"
                    />
                  </label>
                )}
                <p className="mb-3 text-xs text-zinc-400">
                  Click &quot;{applePayAvailable ? "Pay with Apple Pay" : "Pay with Google Pay"}&quot; below to complete your order.
                </p>
                {/* SDK containers: kept in the DOM so attach() works.
                    Visually hidden but NOT display:none — the SDK needs
                    a rendered element to initialise its iframe/button. */}
                {/* Google Pay SDK container: kept in the DOM so attach() works.
                    Visually hidden but NOT display:none — the SDK needs
                    a rendered element to initialise its iframe/button.
                    Apple Pay has no container — it uses the native payment sheet. */}
                <div id="google-pay-container" className="absolute h-0 w-0 overflow-hidden opacity-0 pointer-events-none" />
              </section>

              {/* Card form */}
              <section
                className="rounded-2xl border border-black/10 bg-white p-5"
                style={{ display: payMethod === "card" ? undefined : "none" }}
              >
                <label className="mb-4 block">
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Cardholder Name
                  </span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                    required
                    className="w-full rounded-lg border border-black/15 bg-white px-4 py-3 text-sm outline-none focus:border-black/40"
                  />
                </label>
                {!phone && (
                  <label className="mb-4 block">
                    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                      Phone
                    </span>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(v) => {
                        setPhone(v.target.value);
                        if (loyaltyLookup.status !== "idle") {
                          setLoyaltyLookup({ status: "idle" });
                          setUseReward(false);
                        }
                      }}
                      onBlur={() => lookupLoyalty()}
                      placeholder="0404 123 456"
                      autoComplete="tel"
                      required
                      className="w-full rounded-lg border border-black/15 bg-white px-4 py-3 text-sm outline-none focus:border-black/40"
                    />
                  </label>
                )}
                <div>
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Card Details
                  </span>
                  {SQUARE_ENV !== "production" && (
                    <p className="mb-2 text-[10px] text-zinc-400">
                      Sandbox: <code>4111 1111 1111 1111</code> · 12/27 · 111 · 4215
                    </p>
                  )}
                  <div
                    id="card-container"
                    className="min-h-[90px] rounded-lg border border-black/15 bg-white px-3 py-2"
                  />
                  {!cardReady && (
                    <p className="mt-2 text-xs text-zinc-400">
                      Loading card form…
                    </p>
                  )}
                </div>
              </section>
            </>
          )}

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>

        {/* ── Right column: Order Summary ── */}
        <section className="rounded-2xl border border-black/10 bg-white p-4 sm:p-6 lg:self-start">
          <h3 className="mb-4 text-lg font-bold text-zinc-900 sm:mb-5 sm:text-xl">
            Order Summary
          </h3>

          <ul className="space-y-5">
            {lines.map((line) => (
              <SummaryRow key={line.id} line={line} />
            ))}
          </ul>

          <div className="mt-6 space-y-3 border-t border-black/10 pt-5">
            <div className="flex justify-between text-sm text-zinc-600">
              <span>Subtotal</span>
              <span className="font-semibold text-zinc-900">
                {formatPrice(subtotal)}
              </span>
            </div>
            {canRedeem && useReward && (
              <div className="flex justify-between text-sm">
                <span className="font-semibold" style={{ color: BRAND.primaryColor }}>
                  Free Drink Reward
                </span>
                <span className="font-semibold" style={{ color: BRAND.primaryColor }}>
                  −{formatPrice(rewardDiscount)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm text-zinc-600">
              <span>Tax</span>
              <span className="font-semibold text-zinc-900">
                Calculated at payment
              </span>
            </div>
            <div className="flex justify-between border-t border-black/10 pt-3 text-base">
              <span className="font-bold text-zinc-900">Total</span>
              <span className="text-lg font-bold text-zinc-900">
                {canRedeem && useReward
                  ? formatPrice(subtotal - rewardDiscount > 0n ? subtotal - rewardDiscount : 0n)
                  : formatPrice(subtotal)}
              </span>
            </div>
          </div>

          <button
            type="submit"
            disabled={
              submitting ||
              (!(canRedeemFully && useReward) &&
                (payMethod === "card" ? !cardReady : !walletAvailable))
            }
            className="mt-6 w-full rounded-full py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: BRAND.primaryColor }}
          >
            {submitting
              ? "Processing…"
              : canRedeemFully && useReward
                ? "Redeem Free Drink"
                : payMethod === "wallet"
                  ? walletAvailable
                    ? `Pay with ${applePayAvailable ? "Apple Pay" : "Google Pay"}`
                    : "Loading payment…"
                  : cardReady
                    ? "Place Order"
                    : "Loading payment…"}
          </button>

          <p className="mt-3 text-center text-[11px] text-zinc-400">
            By clicking &quot;Place Order&quot;, you agree to Mandy&apos;s{" "}
            <a href="#" className="underline">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="#" className="underline">
              Privacy Policy
            </a>
            .
          </p>
        </section>
      </form>
    </CheckoutFrame>
  );
}

function CheckoutFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header
        className="w-full px-4 py-6 sm:px-6 sm:py-8"
        style={{ backgroundColor: BRAND.accentColor }}
      >
        <div className="mx-auto max-w-5xl">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="mb-2 flex items-center gap-1 text-sm text-zinc-600 transition hover:text-zinc-900"
          >
            <span aria-hidden="true">←</span> Back
          </button>
          <h1
            className="text-2xl font-bold italic tracking-tight sm:text-3xl"
            style={{ color: BRAND.primaryColor }}
          >
            Checkout
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Finalize your artisanal boba experience.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}


function SummaryRow({ line }: { line: CartLine }) {
  const details = [
    line.variationName,
    ...line.modifiers.map((m) => m.name),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <li className="flex items-start gap-3">
      {/* Item image */}
      {line.itemImageUrl ? (
        <img
          src={line.itemImageUrl}
          alt={line.itemName}
          className="h-14 w-14 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-lg"
          style={{ backgroundColor: BRAND.accentColor }}
        >
          🧋
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold text-zinc-900">
            {line.quantity > 1 && `${line.quantity}× `}
            {line.itemName}
          </p>
          <p
            className="shrink-0 text-sm font-bold"
            style={{ color: BRAND.primaryColor }}
          >
            {formatPrice(lineTotal(line))}
          </p>
        </div>
        {details && (
          <p className="mt-0.5 text-xs text-zinc-500">{details}</p>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

function StarIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

function ApplePayIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.72 7.54c-.48.56-1.27.99-2.03.93-.1-.76.28-1.56.71-2.06.49-.56 1.34-.97 2.03-.99.08.78-.23 1.56-.71 2.12zM17 10.09c-1.12-.06-2.08.64-2.61.64s-1.36-.6-2.24-.59c-1.15.02-2.21.67-2.81 1.7-1.2 2.07-.31 5.14.86 6.83.57.83 1.25 1.76 2.15 1.73.86-.04 1.19-.56 2.23-.56s1.34.56 2.25.54c.93-.02 1.51-.85 2.08-1.68.65-.95.92-1.87.93-1.92-.02-.01-1.79-.69-1.81-2.73-.01-1.7 1.39-2.52 1.46-2.56-.8-1.18-2.04-1.31-2.49-1.34v-.06z" />
    </svg>
  );
}

function GooglePayIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.174-6.806 5.174-4.095 0-7.439-3.389-7.439-7.574s3.345-7.574 7.439-7.574c2.33 0 3.891.989 4.785 1.849l3.254-3.138C18.189 1.186 15.479 0 12.24 0c-6.635 0-12 5.365-12 12s5.365 12 12 12c6.926 0 11.52-4.869 11.52-11.726 0-.788-.085-1.39-.189-1.989H12.24z" fill="currentColor" />
    </svg>
  );
}
