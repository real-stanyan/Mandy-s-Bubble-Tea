"use client";

import Link from "next/link";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useCart,
  lineTotal,
  cartSubtotal,
  type CartLine,
} from "@/store/cart";
import { formatPrice } from "@/lib/utils";
import { BRAND } from "@/lib/constants";

// Checkout + payment. Uses the Square Web Payments SDK to collect a
// card token on-page, then posts { customer, order, payment } through
// our API routes. The SDK is loaded via next/script; we initialize the
// card form once it's ready and the DOM container is mounted.
//
// SDK docs: https://developer.squareup.com/docs/web-payments/overview

// Minimal shape of the Square Web Payments SDK we actually use. The
// real type lives on `window.Square`; we keep our own narrow surface
// rather than adding a full @types dependency.
type CardInstance = {
  attach(selector: string): Promise<void>;
  tokenize(): Promise<{
    status: "OK" | "Invalid" | "Cancel" | string;
    token?: string;
    errors?: { message: string }[];
  }>;
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
  const paymentsRef = useRef<PaymentsInstance | null>(null);

  const subtotal = useMemo(() => cartSubtotal(lines), [lines]);

  // Fetches the loyalty account for the current phone. Called on phone
  // blur. Uses the phone-only /api/customer/lookup (no create) so a
  // typo doesn't leave an empty customer record behind. If the phone
  // isn't on file yet, there's nothing to redeem — surface a friendly
  // "new customer" state.
  async function lookupLoyalty() {
    const trimmedPhone = phone.trim();
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

  // Initialize the Square card form once the SDK has loaded. Attach is
  // keyed on the container mounting, so we wait for both.
  useEffect(() => {
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
  }, [sdkReady]);

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
    if (!cardRef.current) {
      setError("Card form is not ready yet.");
      return;
    }

    setSubmitting(true);
    try {
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

      // 2) Optionally redeem a loyalty reward. We do this before order
      // creation so the loyaltyRewardId can be attached to the order and
      // Square applies the discount server-side. If redemption fails we
      // bail out — charging full price after the user opted in would be
      // a surprise.
      let loyaltyRewardId: string | undefined;
      if (useReward && loyaltyLookup.status === "ready") {
        const redeemRes = await fetch("/api/loyalty/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId: customerJson.customerId,
            phone: phone.trim(),
          }),
        });
        const redeemJson = await redeemRes.json();
        if (!redeemRes.ok || !redeemJson.ok) {
          throw new Error(redeemJson.error ?? "Could not redeem reward");
        }
        loyaltyRewardId = redeemJson.loyaltyRewardId;
      }

      // 3) Create the order (server computes trusted total).
      const orderRes = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerJson.customerId,
          recipientName: name.trim(),
          recipientPhone: phone.trim(),
          note: note.trim() || undefined,
          loyaltyRewardId,
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

      // 4) Tokenize the card via the Web Payments SDK.
      const tokenResult = await cardRef.current.tokenize();
      if (tokenResult.status !== "OK" || !tokenResult.token) {
        const detail =
          tokenResult.errors?.[0]?.message ??
          `Tokenization failed (${tokenResult.status})`;
        throw new Error(detail);
      }

      // 5) Verify the buyer for SCA/3DS. Mandatory in AU for online
      // card payments — skipping this triggers CARD_DECLINED_VERIFICATION_REQUIRED.
      // The amount must match what Square will actually charge, so we
      // read it from the just-created order.
      if (!paymentsRef.current) {
        throw new Error("Payments SDK not initialized");
      }
      const amountMajor = (Number(orderJson.amountCents) / 100).toFixed(2);
      const [firstName, ...restName] = name.trim().split(/\s+/);
      const verification = await paymentsRef.current.verifyBuyer(
        tokenResult.token,
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

      // 6) Charge the token against the order.
      const paymentRes = await fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: tokenResult.token,
          orderId: orderJson.orderId,
          customerId: customerJson.customerId,
          phone: phone.trim(),
          verificationToken: verification.token,
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

      <form onSubmit={handleSubmit} className="grid gap-8 lg:grid-cols-2">
        {/* Customer + card */}
        <section>
          <h2 className="mb-4 text-lg font-semibold text-zinc-900">
            Your details
          </h2>
          <div className="space-y-4">
            <Field
              label="Name"
              value={name}
              onChange={setName}
              placeholder="Your name"
              autoComplete="name"
              required
            />
            <Field
              label="Phone"
              value={phone}
              onChange={(v) => {
                setPhone(v);
                // If the user edits the phone after a lookup, drop the
                // stale loyalty result so they don't accidentally redeem
                // against a different account.
                if (loyaltyLookup.status !== "idle") {
                  setLoyaltyLookup({ status: "idle" });
                  setUseReward(false);
                }
              }}
              onBlur={lookupLoyalty}
              placeholder="0404 123 456"
              type="tel"
              autoComplete="tel"
              required
              hint="We use this to send pickup updates."
            />
            <TextArea
              label="Pickup note (optional)"
              value={note}
              onChange={setNote}
              placeholder="Anything we should know?"
            />
          </div>

          <h2 className="mb-2 mt-8 text-lg font-semibold text-zinc-900">
            Payment
          </h2>
          {SQUARE_ENV !== "production" && (
            <p className="mb-3 text-xs text-zinc-500">
              Sandbox test card: <code>4111 1111 1111 1111</code>, expiry{" "}
              <code>12/27</code>, CVV <code>111</code>, postcode{" "}
              <code>4215</code>.
            </p>
          )}
          <div
            id="card-container"
            className="min-h-[90px] rounded-md border border-black/15 bg-white px-3 py-2"
          />
          {!cardReady && (
            <p className="mt-2 text-xs text-zinc-400">Loading card form…</p>
          )}

          {error && (
            <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </section>

        {/* Order summary */}
        <section>
          <h2 className="mb-4 text-lg font-semibold text-zinc-900">
            Order summary
          </h2>
          <ul className="divide-y divide-black/10 rounded-lg border border-black/10 bg-white">
            {lines.map((line) => (
              <SummaryRow key={line.id} line={line} />
            ))}
          </ul>

          {loyaltyLookup.status === "loading" && (
            <p className="mt-4 text-xs text-zinc-500">
              Checking your loyalty balance…
            </p>
          )}
          {loyaltyLookup.status === "ready" && loyaltyLookup.starsPerReward === 0 && (
            <p className="mt-4 text-xs text-zinc-500">
              New here? You&apos;ll earn stars on your first order toward a free
              drink.
            </p>
          )}
          {loyaltyLookup.status === "ready" && loyaltyLookup.starsPerReward > 0 &&
            (loyaltyLookup.balance >= loyaltyLookup.starsPerReward ? (
              <label
                className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border p-3"
                style={{
                  borderColor: BRAND.primaryColor,
                  backgroundColor: BRAND.accentColor,
                }}
              >
                <input
                  type="checkbox"
                  checked={useReward}
                  onChange={(e) => setUseReward(e.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <span className="text-sm">
                  <span
                    className="block font-semibold"
                    style={{ color: BRAND.primaryColor }}
                  >
                    Redeem free drink ⭐ ({loyaltyLookup.starsPerReward} stars)
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-600">
                    You have {loyaltyLookup.balance} stars. Square will apply
                    the discount at checkout.
                  </span>
                </span>
              </label>
            ) : (
              <p className="mt-4 text-xs text-zinc-500">
                You have {loyaltyLookup.balance} / {loyaltyLookup.starsPerReward}{" "}
                stars — {loyaltyLookup.starsPerReward - loyaltyLookup.balance}{" "}
                to go for a free drink.
              </p>
            ))}

          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-sm text-zinc-600">Subtotal</span>
            <span className="text-xl font-semibold text-zinc-900">
              {formatPrice(subtotal)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">
            Taxes and loyalty discounts calculated by Square.
          </p>

          <button
            type="submit"
            disabled={submitting || !cardReady}
            className="mt-6 w-full rounded-full py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: BRAND.primaryColor }}
          >
            {submitting
              ? "Processing…"
              : cardReady
                ? "Pay & place order"
                : "Loading payment…"}
          </button>
        </section>
      </form>
    </CheckoutFrame>
  );
}

function CheckoutFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header
        className="w-full px-6 py-8 text-white"
        style={{ backgroundColor: BRAND.primaryColor }}
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-2">
          <Link href="/menu" className="text-sm opacity-80 hover:opacity-100">
            ← Menu
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">Checkout</h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {children}
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  autoComplete,
  required,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-700">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-black/40"
      />
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-700">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-none rounded-md border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-black/40"
      />
    </label>
  );
}

function SummaryRow({ line }: { line: CartLine }) {
  return (
    <li className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-zinc-900">
          {line.quantity}× {line.itemName}
        </p>
        {line.variationName && (
          <p className="text-xs text-zinc-500">{line.variationName}</p>
        )}
        {line.modifiers.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {line.modifiers.map((m) => (
              <li key={m.id} className="truncate text-xs text-zinc-500">
                + {m.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-sm font-semibold text-zinc-900">
        {formatPrice(lineTotal(line))}
      </p>
    </li>
  );
}
