"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { useRouter } from "next/navigation";
import {
  useCart,
  lineTotal,
  lineUnitPrice,
  cartSubtotal,
  cardSurcharge,
  type CartLine,
} from "@/store/cart";
import { formatPrice } from "@/lib/utils";
import { BRAND, CARD_SURCHARGE, LOYALTY } from "@/lib/constants";
import { PaymentErrorDialog } from "@/components/checkout/PaymentErrorDialog";
import { useAuth } from "@/components/auth/AuthProvider";

const REDEEM_STORAGE_KEY = "mbt:cart:useReward";

// Right-side slide-out drawer. Mounted once in the root layout so it's
// available from every page. Backdrop click and ESC close the drawer.

import type {
  ApplePayInstance,
  GooglePayInstance,
  PaymentsInstance,
} from "@/types/square-sdk";
import "@/types/square-sdk";

const SQUARE_ENV = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT ?? "sandbox";
const WEB_SDK_SRC =
  SQUARE_ENV === "production"
    ? "https://web.squarecdn.com/v1/square.js"
    : "https://sandbox.web.squarecdn.com/v1/square.js";
const SQUARE_APP_ID = process.env.NEXT_PUBLIC_SQUARE_APP_ID ?? "";
const SQUARE_LOCATION_ID = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID ?? "";

export function CartDrawer() {
  const isOpen = useCart((s) => s.isOpen);
  const hydrated = useCart((s) => s.hydrated);
  const lines = useCart((s) => s.lines);
  const closeDrawer = useCart((s) => s.closeDrawer);
  const setQuantity = useCart((s) => s.setQuantity);
  const removeLine = useCart((s) => s.removeLine);

  // Close on ESC.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, closeDrawer]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  // Avoid SSR hydration mismatch — server renders nothing for this drawer.
  if (!hydrated) return null;

  const itemCount = lines.reduce((n, l) => n + l.quantity, 0);

  return (
    <div
      aria-hidden={!isOpen}
      className={`fixed inset-0 z-50 ${
        isOpen ? "pointer-events-auto" : "pointer-events-none"
      }`}
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
        onClick={closeDrawer}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-label="Shopping cart"
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-xl transition-transform ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <header className="flex items-start justify-between px-5 pt-6 pb-4">
          <div>
            <h2 className="text-xl font-bold text-zinc-900">Your Cart</h2>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              {itemCount} item{itemCount !== 1 ? "s" : ""} selected
            </p>
          </div>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Close cart"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 text-sm text-zinc-500 transition hover:bg-zinc-50"
          >
            ✕
          </button>
        </header>

        <CartBody
          lines={lines}
          isOpen={isOpen}
          closeDrawer={closeDrawer}
          setQuantity={setQuantity}
          removeLine={removeLine}
        />
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Cart body — manages shared loyalty state for card + footer          */
/* ------------------------------------------------------------------ */

function CartBody({
  lines,
  isOpen,
  closeDrawer,
  setQuantity,
  removeLine,
}: {
  lines: CartLine[];
  isOpen: boolean;
  closeDrawer: () => void;
  setQuantity: (id: string, q: number) => void;
  removeLine: (id: string) => void;
}) {
  const { profile, loyalty, welcomeDiscount, starsPerReward: authStarsPerReward } =
    useAuth();
  const [useReward, setUseReward] = useState(false);

  // SDK state for wallet quick-pay.
  const [sdkReady, setSdkReady] = useState(false);
  const [applePayReady, setApplePayReady] = useState(false);
  const [googlePayReady, setGooglePayReady] = useState(false);
  const applePayRef = useRef<ApplePayInstance | null>(null);
  const googlePayRef = useRef<GooglePayInstance | null>(null);
  const paymentsRef = useRef<PaymentsInstance | null>(null);
  // Defer SDK loading until the drawer has been opened at least once.
  const [everOpened, setEverOpened] = useState(false);
  useEffect(() => {
    if (isOpen && !everOpened) setEverOpened(true);
  }, [isOpen, everOpened]);

  const starsPerReward = authStarsPerReward || LOYALTY.starsPerReward;
  const stars = loyalty?.balance ?? 0;
  const canRedeem = stars >= starsPerReward && starsPerReward > 0;

  // Initialize Square SDK + wallet payment methods.
  const subtotal = useMemo(() => cartSubtotal(lines), [lines]);
  const surchargeAmount = useMemo(() => cardSurcharge(subtotal), [subtotal]);

  const welcomeCoverage = useMemo(() => {
    if (!welcomeDiscount.available || lines.length === 0) {
      return { coveredCount: 0, discountCents: 0n };
    }
    const unitPrices: bigint[] = [];
    for (const line of lines) {
      const unit = lineUnitPrice(line);
      for (let i = 0; i < line.quantity; i++) unitPrices.push(unit);
    }
    unitPrices.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const K = Math.min(welcomeDiscount.drinksRemaining, unitPrices.length);
    if (K === 0) return { coveredCount: 0, discountCents: 0n };
    const coveredSum = unitPrices.slice(0, K).reduce((s, p) => s + p, 0n);
    return {
      coveredCount: K,
      discountCents:
        (coveredSum * BigInt(welcomeDiscount.percentage)) / 100n,
    };
  }, [lines, welcomeDiscount]);
  const welcomeDiscountAmount = welcomeCoverage.discountCents;

  useEffect(() => {
    if (!sdkReady || lines.length === 0) return;
    if (!SQUARE_APP_ID || !SQUARE_LOCATION_ID) return;
    if (paymentsRef.current) return;

    const square = window.Square;
    if (!square) return;
    const payments = square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID);
    paymentsRef.current = payments;

    // Apple Pay — no attach needed.
    (async () => {
      try {
        const pr = payments.paymentRequest({
          countryCode: "AU",
          currencyCode: "AUD",
          total: {
            amount: (Number(subtotal + surchargeAmount) / 100).toFixed(2),
            label: BRAND.name,
          },
        });
        const ap = await payments.applePay(pr);
        applePayRef.current = ap;
        setApplePayReady(true);
      } catch {
        // Not available on this device/browser
      }
    })();

    // Google Pay — needs a DOM container.
    let gpCancelled = false;
    (async () => {
      try {
        const pr = payments.paymentRequest({
          countryCode: "AU",
          currencyCode: "AUD",
          total: {
            amount: (Number(subtotal + surchargeAmount) / 100).toFixed(2),
            label: BRAND.name,
          },
        });
        const gp = await payments.googlePay(pr);
        if (gpCancelled) { gp.destroy().catch(() => {}); return; }
        await gp.attach("#cart-google-pay-container");
        if (gpCancelled) { gp.destroy().catch(() => {}); return; }
        googlePayRef.current = gp;
        setGooglePayReady(true);
      } catch {
        // Not available
      }
    })();

    return () => {
      gpCancelled = true;
      googlePayRef.current?.destroy().catch(() => {});
      googlePayRef.current = null;
      applePayRef.current = null;
      paymentsRef.current = null;
      setApplePayReady(false);
      setGooglePayReady(false);
    };
    // Only init once when SDK becomes ready — subtotal changes are fine
    // since we re-create the paymentRequest at tokenize time anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkReady, lines.length > 0]);

  // Cheapest drink unit price = reward discount amount.
  const rewardDiscount = useMemo(() => {
    if (lines.length === 0) return 0n;
    let cheapest = lineUnitPrice(lines[0]);
    for (const l of lines) {
      const up = lineUnitPrice(l);
      if (up < cheapest) cheapest = up;
    }
    return cheapest;
  }, [lines]);

  // Persist redeem preference so checkout can pick it up.
  useEffect(() => {
    try {
      if (useReward) {
        window.localStorage.setItem(REDEEM_STORAGE_KEY, "1");
      } else {
        window.localStorage.removeItem(REDEEM_STORAGE_KEY);
      }
    } catch { /* noop */ }
  }, [useReward]);

  // Reset redeem when user no longer qualifies.
  useEffect(() => {
    if (!canRedeem) setUseReward(false);
  }, [canRedeem]);

  return (
    <>
      {/* Load Square SDK for wallet quick-pay — deferred until first drawer open */}
      {everOpened && (
        <Script
          src={WEB_SDK_SRC}
          strategy="afterInteractive"
          onReady={() => setSdkReady(true)}
        />
      )}
      {/* Hidden Google Pay SDK container */}
      <div id="cart-google-pay-container" className="absolute h-0 w-0 overflow-hidden opacity-0 pointer-events-none" />

      <div className="flex-1 overflow-y-auto px-5">
        {lines.length === 0 ? (
          <EmptyState onClose={closeDrawer} />
        ) : (
          <>
            <TeaJourneyCard
              stars={stars}
              starsPerReward={starsPerReward}
              canRedeem={canRedeem}
              useReward={useReward}
              onToggleReward={() => setUseReward((v) => !v)}
            />

            <div className="mt-5 space-y-5">
              {lines.map((line) => (
                <CartLineRow
                  key={line.id}
                  line={line}
                  onQuantityChange={(q) => setQuantity(line.id, q)}
                  onRemove={() => removeLine(line.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {lines.length > 0 && (
        <CartFooter
          lines={lines}
          useReward={useReward}
          rewardDiscount={rewardDiscount}
          welcomeDiscount={welcomeDiscount}
          welcomeDiscountAmount={welcomeDiscountAmount}
          welcomeCoveredCount={welcomeCoverage.coveredCount}
          surchargeAmount={surchargeAmount}
          hasProfile={!!profile}
          applePayReady={applePayReady}
          googlePayReady={googlePayReady}
          applePayRef={applePayRef}
          googlePayRef={googlePayRef}
          paymentsRef={paymentsRef}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Tea Journey (loyalty progress)                                     */
/* ------------------------------------------------------------------ */

const TeaJourneyCard = memo(function TeaJourneyCard({
  stars,
  starsPerReward,
  canRedeem,
  useReward,
  onToggleReward,
}: {
  stars: number;
  starsPerReward: number;
  canRedeem: boolean;
  useReward: boolean;
  onToggleReward: () => void;
}) {
  const remaining = Math.max(starsPerReward - stars, 0);
  const progressPct = Math.min((stars / starsPerReward) * 100, 100);

  return (
    <div
      className="rounded-2xl p-4"
      style={{ backgroundColor: BRAND.accentColor }}
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-bold text-zinc-900">Your Tea Journey</h3>
          <p className="mt-0.5 text-xs text-zinc-600">
            {canRedeem
              ? "You've earned a free drink!"
              : stars > 0
                ? `${remaining} more star${remaining !== 1 ? "s" : ""} until your next free treat!`
                : "Start earning stars toward a free drink!"}
          </p>
        </div>
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: BRAND.primaryColor }}
        >
          <StarIcon />
        </span>
      </div>
      {/* Progress bar */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/60">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${progressPct}%`,
            backgroundColor: BRAND.primaryColor,
          }}
        />
      </div>
      <div className="mt-1.5 text-[10px] font-semibold text-zinc-500">
        <span>
          {stars} / {starsPerReward} Stars
        </span>
      </div>

      {/* Redeem toggle */}
      {canRedeem && (
        <button
          type="button"
          onClick={onToggleReward}
          className={`mt-3 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
            useReward
              ? "bg-white text-zinc-900"
              : "bg-white/60 text-zinc-700 hover:bg-white/80"
          }`}
          style={useReward ? { boxShadow: `0 0 0 2px ${BRAND.primaryColor}` } : undefined}
        >
          <span className="flex items-center gap-1.5">
            🎉 Redeem free drink
          </span>
          <span
            className={`flex h-5 w-9 items-center rounded-full transition-colors ${
              useReward ? "justify-end" : "justify-start bg-zinc-300"
            }`}
            style={useReward ? { backgroundColor: BRAND.primaryColor } : undefined}
          >
            <span className="mx-0.5 h-4 w-4 rounded-full bg-white shadow" />
          </span>
        </button>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

function EmptyState({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <p className="text-base text-zinc-600">Your cart is empty.</p>
      <Link
        href="/menu"
        onClick={onClose}
        className="rounded-full px-5 py-2 text-sm font-medium text-white"
        style={{ backgroundColor: BRAND.primaryColor }}
      >
        Browse menu
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Cart line row                                                      */
/* ------------------------------------------------------------------ */

const CartLineRow = memo(function CartLineRow({
  line,
  onQuantityChange,
  onRemove,
}: {
  line: CartLine;
  onQuantityChange: (q: number) => void;
  onRemove: () => void;
}) {
  const total = lineTotal(line);
  const details = [
    line.variationName,
    ...line.modifiers.map((m) => m.name),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex gap-3">
      {/* Image */}
      {line.itemImageUrl ? (
        <Image
          src={line.itemImageUrl}
          alt=""
          width={64}
          height={64}
          className="h-16 w-16 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl text-lg"
          style={{ backgroundColor: BRAND.accentColor }}
        >
          🧋
        </div>
      )}

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold text-zinc-900">{line.itemName}</p>
          <p
            className="shrink-0 text-sm font-bold"
            style={{ color: BRAND.primaryColor }}
          >
            {formatPrice(total)}
          </p>
        </div>
        {details && (
          <p className="mt-0.5 text-xs text-zinc-500">{details}</p>
        )}

        {/* Quantity + Remove */}
        <div className="mt-2 flex items-center justify-between">
          <QuantityStepper value={line.quantity} onChange={onQuantityChange} />
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove item"
            className="text-xs font-medium transition hover:opacity-70"
            style={{ color: BRAND.primaryColor }}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Quantity stepper                                                    */
/* ------------------------------------------------------------------ */

function QuantityStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (q: number) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-black/10">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        aria-label="Decrease quantity"
        className="flex h-7 w-7 items-center justify-center rounded-l-full text-sm text-zinc-600 hover:bg-black/5"
      >
        −
      </button>
      <span className="w-6 text-center text-sm font-medium">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        aria-label="Increase quantity"
        className="flex h-7 w-7 items-center justify-center rounded-r-full text-sm text-zinc-600 hover:bg-black/5"
      >
        +
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Footer                                                             */
/* ------------------------------------------------------------------ */

function CartFooter({
  lines,
  useReward,
  rewardDiscount,
  welcomeDiscount,
  welcomeDiscountAmount,
  welcomeCoveredCount,
  surchargeAmount,
  hasProfile,
  applePayReady,
  googlePayReady,
  applePayRef,
  googlePayRef,
  paymentsRef,
}: {
  lines: CartLine[];
  useReward: boolean;
  rewardDiscount: bigint;
  welcomeDiscount: {
    available: boolean;
    percentage: number;
    drinksRemaining: number;
  };
  welcomeDiscountAmount: bigint;
  welcomeCoveredCount: number;
  surchargeAmount: bigint;
  hasProfile: boolean;
  applePayReady: boolean;
  googlePayReady: boolean;
  applePayRef: React.RefObject<ApplePayInstance | null>;
  googlePayRef: React.RefObject<GooglePayInstance | null>;
  paymentsRef: React.RefObject<PaymentsInstance | null>;
}) {
  const subtotal = cartSubtotal(lines);
  const closeDrawer = useCart((s) => s.closeDrawer);
  const clear = useCart((s) => s.clear);
  const router = useRouter();
  const isIOS = useIsIOS();
  const { profile, refresh } = useAuth();

  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMethod, setLastMethod] = useState<"apple" | "google" | null>(null);

  // Reward and welcome display are mutually exclusive in the total math
  // (matches /checkout). Square still applies both at charge time — the
  // server-trusted totalMoney is authoritative.
  const discountedTotal = useReward
    ? subtotal - rewardDiscount > 0n
      ? subtotal - rewardDiscount
      : 0n
    : welcomeDiscount.available
      ? subtotal - welcomeDiscountAmount > 0n
        ? subtotal - welcomeDiscountAmount
        : 0n
      : subtotal;
  // Loyalty reward that fully covers the drinks → no card is charged,
  // so the server skips the surcharge and the footer hides it.
  const isFreeRedeem = useReward && subtotal - rewardDiscount <= 0n;
  const effectiveSurcharge = isFreeRedeem ? 0n : surchargeAmount;
  const displayTotal = discountedTotal + effectiveSurcharge;

  // Full wallet payment flow — runs entirely in the cart drawer.
  const handleWalletPay = useCallback(
    async (method: "apple" | "google") => {
      if (paying) return;
      setError(null);
      setLastMethod(method);

      if (!hasProfile || !profile) {
        // No signed-in user — punt to checkout where SignInCard will guide them.
        closeDrawer();
        router.push("/checkout");
        return;
      }

      setPaying(true);
      try {
        // 0) Tokenize IMMEDIATELY — must stay in the user gesture frame.
        const walletInstance =
          method === "apple" ? applePayRef.current : googlePayRef.current;
        if (!walletInstance) throw new Error("Wallet not ready");
        const tokenResult = await walletInstance.tokenize();
        if (tokenResult.status !== "OK" || !tokenResult.token) {
          const detail =
            tokenResult.errors?.[0]?.message ??
            `Tokenization failed (${tokenResult.status})`;
          throw new Error(detail);
        }
        const sourceToken = tokenResult.token;

        // 1) Create order — customer/phone derived server-side from session.
        const orderRes = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applyWelcomeDiscount: welcomeDiscount.available,
            applyLoyaltyReward: isFreeRedeem,
            lines: lines.map((l) => ({
              itemName: l.itemName,
              variationId: l.variationId,
              variationName: l.variationName,
              variationPriceCents: Number(l.variationPriceCents),
              modifiers: l.modifiers.map((m) => ({
                id: m.id,
                name: m.name,
                priceCents: Number(m.priceCents),
              })),
              quantity: l.quantity,
            })),
          }),
        });
        const orderJson = await orderRes.json();
        if (!orderRes.ok || !orderJson.ok) {
          throw new Error(orderJson.error ?? "Order creation failed");
        }

        // 2) Optionally redeem loyalty reward.
        let amountCents: string = orderJson.amountCents;
        if (useReward) {
          const redeemRes = await fetch("/api/loyalty/redeem", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: orderJson.orderId }),
          });
          const redeemJson = await redeemRes.json();
          if (!redeemRes.ok || !redeemJson.ok) {
            throw new Error(redeemJson.error ?? "Could not redeem reward");
          }
          if (typeof redeemJson.updatedAmountCents === "string") {
            amountCents = redeemJson.updatedAmountCents;
          }
        }

        // 3) verifyBuyer (SCA required in AU for all methods).
        const isFreeOrder =
          amountCents === "0" || Number(amountCents) === 0;

        let verificationToken: string | undefined;
        if (!isFreeOrder) {
          if (!paymentsRef.current) throw new Error("SDK not initialized");
          const amountMajor = (Number(amountCents) / 100).toFixed(2);
          const givenName = profile.first_name ?? "";
          const familyName = profile.last_name ?? "";
          const verification = await paymentsRef.current.verifyBuyer(
            sourceToken,
            {
              amount: amountMajor,
              currencyCode: "AUD",
              intent: "CHARGE",
              billingContact: {
                givenName,
                familyName: familyName || undefined,
                phone: profile.phone_e164,
                countryCode: "AU",
              },
              customerInitiated: true,
              sellerKeyedIn: false,
            },
          );
          verificationToken = verification.token;
        }

        // 4) Pay.
        const paymentRes = await fetch("/api/payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceId: sourceToken,
            orderId: orderJson.orderId,
            verificationToken,
          }),
        });
        const paymentJson = await paymentRes.json();
        if (!paymentRes.ok || !paymentJson.ok) {
          throw new Error(paymentJson.error ?? "Payment failed");
        }

        // If the server consumed our welcome discount, refresh auth state so
        // welcomeDiscount.available flips back to false everywhere.
        if (paymentJson.welcomeDiscountConsumed) {
          void refresh();
        }

        // Success — clear cart and go to confirmation.
        clear();
        closeDrawer();
        router.push(`/order-confirmation/${orderJson.orderId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setPaying(false);
      }
    },
    [
      paying, hasProfile, profile,
      useReward, lines, applePayRef, googlePayRef, paymentsRef,
      clear, closeDrawer, router, refresh,
      welcomeDiscount.available,
    ],
  );

  // Determine which wallet button to show.
  const showApple = applePayReady;
  const showGoogle = googlePayReady && !applePayReady; // prefer Apple Pay on iOS

  return (
    <footer className="border-t border-black/10 px-5 pb-6 pt-5">
      <PaymentErrorDialog
        open={!!error}
        message={error}
        onCancel={() => setError(null)}
        onRetry={() => {
          setError(null);
          if (lastMethod) handleWalletPay(lastMethod);
        }}
      />

      <div className="space-y-2">
        <div className="flex justify-between text-sm text-zinc-600">
          <span>Subtotal</span>
          <span className="font-semibold text-zinc-900">
            {formatPrice(subtotal)}
          </span>
        </div>
        {useReward && (
          <div className="flex justify-between text-sm">
            <span className="text-green-600">Free drink reward</span>
            <span className="font-semibold text-green-600">
              −{formatPrice(rewardDiscount)}
            </span>
          </div>
        )}
        {!useReward &&
          welcomeDiscount.available &&
          welcomeCoveredCount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: BRAND.primaryColor }}
                />
                Welcome {welcomeDiscount.percentage}% Off
                <span className="text-xs text-zinc-500">
                  ({welcomeCoveredCount} drink
                  {welcomeCoveredCount === 1 ? "" : "s"})
                </span>
              </span>
              <span style={{ color: BRAND.primaryColor }}>
                −{formatPrice(welcomeDiscountAmount)}
              </span>
            </div>
          )}
        {effectiveSurcharge > 0n && (
          <div className="flex justify-between text-sm text-zinc-600">
            <span>
              {CARD_SURCHARGE.name}{" "}
              <span className="text-xs text-zinc-400">
                ({CARD_SURCHARGE.percentage}%)
              </span>
            </span>
            <span className="font-semibold text-zinc-900">
              {formatPrice(effectiveSurcharge)}
            </span>
          </div>
        )}
        <div className="flex justify-between text-sm text-zinc-600">
          <span>Tax</span>
          <span className="font-semibold text-zinc-900">
            At checkout
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between border-t border-black/10 pt-3">
        <span className="text-base font-bold text-zinc-900">Total Price</span>
        <span
          className="text-xl font-bold"
          style={{ color: BRAND.primaryColor }}
        >
          {formatPrice(displayTotal)}
        </span>
      </div>

      {/* Wallet quick-pay — real payment, no redirect */}
      {showApple && (
        <button
          type="button"
          disabled={paying}
          onClick={() => handleWalletPay("apple")}
          className="mt-5 flex w-full items-center justify-center gap-0.5 rounded-xl bg-black py-3.5 text-base text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {paying ? "Processing…" : <>Buy with <AppleLogo className="ml-0.5 -mt-0.5" /><span className="font-semibold">Pay</span></>}
        </button>
      )}
      {showGoogle && (
        <button
          type="button"
          disabled={paying}
          onClick={() => handleWalletPay("google")}
          className="mt-5 flex w-full items-center justify-center gap-1 rounded-xl bg-[#3c4043] py-3.5 text-base text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {paying ? "Processing…" : <>Buy with <GoogleGLogo /> <span className="font-semibold">Pay</span></>}
        </button>
      )}
      {/* Fallback if wallet not ready yet — still a link */}
      {!showApple && !showGoogle && (
        <Link
          href="/checkout"
          onClick={closeDrawer}
          className={`mt-5 flex w-full items-center justify-center gap-1 rounded-xl py-3.5 text-base transition hover:opacity-90 ${
            isIOS ? "bg-black text-white" : "bg-[#3c4043] text-white"
          }`}
        >
          {isIOS ? (
            <>Buy with <AppleLogo className="ml-0.5 -mt-0.5" /><span className="font-semibold">Pay</span></>
          ) : (
            <>Buy with <GoogleGLogo /> <span className="font-semibold">Pay</span></>
          )}
        </Link>
      )}

      <Link
        href="/checkout"
        onClick={closeDrawer}
        className="mt-3 block w-full rounded-full border-2 py-3 text-center text-sm font-semibold transition hover:opacity-90"
        style={{ borderColor: BRAND.primaryColor, color: BRAND.primaryColor }}
      >
        Checkout
      </Link>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/*  Platform detection                                                  */
/* ------------------------------------------------------------------ */

function useIsIOS() {
  const [isIOS, setIsIOS] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent;
    setIsIOS(/iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  }, []);
  return isIOS;
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

function StarIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function AppleLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="24"
      viewBox="0 0 814 1000"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57.8-155.5-127.4c-58.8-82-106.4-209.5-106.4-330.8 0-194.3 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 103.5-30.4 135.5-71.3z" />
    </svg>
  );
}

function GoogleGLogo() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 48 48"
      aria-hidden="true"
    >
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#34A853" d="M10.53 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.28-3.14.76-4.59l-7.98-6.19A23.99 23.99 0 0 0 0 24c0 3.77.9 7.35 2.56 10.53l7.97-5.94z" />
      <path fill="#FBBC05" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 5.94C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
