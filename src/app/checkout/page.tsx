"use client";

import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useCart,
  cupKey,
  lineTotal,
  lineUnitPrice,
  cartSubtotal,
  cardSurcharge,
  platformFee,
  publicHolidaySurcharge,
  type CartLine,
} from "@/store/cart";
import { formatPrice } from "@/lib/utils";
import { BRAND, CARD_SURCHARGE, DELIVERY_FEE_NAME, LOYALTY, PH_SURCHARGE, PLATFORM_FEE, SERVICE_FEE } from "@/lib/constants";
import { FulfillmentSelector, type FulfillmentType } from "@/components/checkout/FulfillmentSelector";
import { getPreferredFulfillment, resolveInitialFulfillment } from "@/lib/order-mode";
import { welcomeDiscountEligible } from "@/lib/promo-eligibility";
import { DeliveryAddressForm, type DeliveryAddress } from "@/components/checkout/DeliveryAddressForm";
import { DeliveryQuoteCard, type QuoteState } from "@/components/checkout/DeliveryQuoteCard";
import { isDeliveryHoursOpen } from "@/lib/delivery-hours";
import { isDeliveryEligible } from "@/lib/delivery-fee";
import { isDeliverablePostcode } from "@/lib/delivery-zone";
import { pickPromoCups } from "@/lib/promo-cup-pick";
import { isPublicHolidayActive } from "@/lib/holiday";
import type { OrderingStatus } from "@/lib/store-status";
import { buildPaymentRequestBody } from "@/lib/cup-label/payment-request";
import { buildPaymentSelections } from "@/lib/cup-label/build-payment-selections";
import { computeCupLabelGate } from "@/lib/cup-label/checkout-gate";
import { PaymentErrorDialog } from "@/components/checkout/PaymentErrorDialog";
import { OrderBlockedDialog } from "@/components/checkout/OrderBlockedDialog";
import { classifyOrderBlock, type OrderBlock } from "@/lib/checkout/order-block";
import { PickupReminderDialog } from "@/components/checkout/PickupReminderDialog";
import { CupLabelSection } from "@/components/checkout/CupLabelSection";
import { SignInCard } from "@/components/auth/SignInCard";
import { useAuth } from "@/components/auth/AuthProvider";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { reportClientError, describeError } from "@/lib/client-error-report";
import { tierFor } from "@/lib/membership-tier";
import { tierCheckoutPreview } from "@/lib/tier-checkout-preview";
import type { CupRecord } from "@/lib/tier-toppings";

// Checkout + payment. Uses the Square Web Payments SDK to collect a
// card token on-page, then posts { order, payment } through our API
// routes — the customer is derived server-side from the Supabase
// session, so no name/phone/customerId is sent from the client.
//
// SDK docs: https://developer.squareup.com/docs/web-payments/overview

import type {
  CardInstance,
  ApplePayInstance,
  GooglePayInstance,
  PaymentsInstance,
} from "@/types/square-sdk";
// Ensure the global Window.Square augmentation is loaded.
import "@/types/square-sdk";

const SQUARE_ENV = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT ?? "sandbox";
const WEB_SDK_SRC =
  SQUARE_ENV === "production"
    ? "https://web.squarecdn.com/v1/square.js"
    : "https://sandbox.web.squarecdn.com/v1/square.js";
const SQUARE_APP_ID = process.env.NEXT_PUBLIC_SQUARE_APP_ID ?? "";
const SQUARE_LOCATION_ID =
  process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID ?? "";

export default function CheckoutPage() {
  const hydrated = useCart((s) => s.hydrated);
  const lines = useCart((s) => s.lines);
  const { profile, loading: authLoading, refresh } = useAuth();

  // Wait for cart + auth to hydrate.
  if (!hydrated || authLoading) {
    return (
      <CheckoutFrame>
        <LoadingSpinner />
      </CheckoutFrame>
    );
  }

  if (lines.length === 0) {
    return (
      <CheckoutFrame>
        <div className="rounded-lg border border-dashed border-black/20 p-12 text-center">
          <p className="mb-4 text-ink2">Your cart is empty.</p>
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

  // Not signed in — show the sign-in surface before any payment UI.
  if (!profile) {
    return (
      <CheckoutFrame>
        <SignInCard
          heading="Sign in to check out"
          subheading="We use your profile for the receipt and loyalty stars — quickest way is Apple or Google."
          onComplete={refresh}
        />
      </CheckoutFrame>
    );
  }

  return <CheckoutSignedIn lines={lines} />;
}

function CheckoutSignedIn({ lines }: { lines: CartLine[] }) {
  const router = useRouter();
  const clear = useCart((s) => s.clear);
  const labelSelections = useCart((s) => s.labelSelections);
  const keepLabelCopy = useCart((s) => s.keepLabelCopy);
  const setKeepLabelCopy = useCart((s) => s.setKeepLabelCopy);
  const {
    profile,
    loyalty,
    welcomeDiscount,
    igFollowDiscount,
    starsPerReward: authStarsPerReward,
    refresh,
  } = useAuth();
  if (!profile) {
    // Should never happen — parent gates this. But TS can't prove it.
    throw new Error("CheckoutSignedIn rendered without profile");
  }

  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  // Delivery eligibility rejections from /api/orders surface here instead of
  // the payment-failed dialog — they're not payment failures and "Retry"
  // wouldn't help (see classifyOrderBlock).
  const [orderBlock, setOrderBlock] = useState<OrderBlock | null>(null);
  const [fulfillment, setFulfillment] = useState<FulfillmentType>("PICKUP");
  const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddress>({
    address: "",
    lat: 0,
    lng: 0,
    unit: "",
    driverNote: "",
    phone: profile.phone_e164,
    postcode: "",
  });
  const [quoteState, setQuoteState] = useState<QuoteState>({ kind: "idle" });
  const [hoursOpen, setHoursOpen] = useState(() => isDeliveryHoursOpen());
  const [sdkReady, setSdkReady] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const [applePayAvailable, setApplePayAvailable] = useState(false);
  const [googlePayAvailable, setGooglePayAvailable] = useState(false);
  const walletAvailable = applePayAvailable || googlePayAvailable;
  const [payMethod, setPayMethod] = useState<"card" | "apple" | "google">("card");

  const [rewardCount, setRewardCount] = useState(0);

  const cardRef = useRef<CardInstance | null>(null);
  const applePayRef = useRef<ApplePayInstance | null>(null);
  const googlePayRef = useRef<GooglePayInstance | null>(null);
  const paymentsRef = useRef<PaymentsInstance | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applePayRequestRef = useRef<any>(null);

  const subtotal = useMemo(() => cartSubtotal(lines), [lines]);

  // Apply the session order-mode preference (set from the home popup) as the
  // fulfillment default — once, on entry. DELIVERY is honored only when it's
  // enabled and the subtotal meets the minimum, otherwise we fall back to
  // PICKUP. Runs after cart hydration (this component only renders post-hydrate)
  // so `subtotal` is accurate; the ref guard keeps a later manual toggle intact.
  const appliedOrderModeRef = useRef(false);
  useEffect(() => {
    if (appliedOrderModeRef.current) return;
    appliedOrderModeRef.current = true;
    const mode = resolveInitialFulfillment(
      getPreferredFulfillment(),
      subtotal,
      process.env.NEXT_PUBLIC_DELIVERY_ENABLED === "true",
    );
    if (mode !== "PICKUP") setFulfillment(mode);
  }, [subtotal]);

  // Expand all cup unit prices, sorted ascending — used for multi-reward discount.
  const sortedUnitPrices = useMemo(() => {
    const cups: bigint[] = [];
    for (const line of lines) {
      const unit = lineUnitPrice(line);
      for (let i = 0; i < line.quantity; i++) cups.push(unit);
    }
    return cups.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }, [lines]);

  // Sum of the cheapest N cup prices — the reward discount for rewardCount cups.
  const rewardDiscount = useMemo(
    () =>
      sortedUnitPrices
        .slice(0, rewardCount)
        .reduce((sum, p) => sum + p, 0n),
    [sortedUnitPrices, rewardCount],
  );

  const promoCoverage = useMemo(() => {
    if (sortedUnitPrices.length === 0) {
      return {
        welcomeCount: 0,
        welcomeDiscountCents: 0n,
        igFollowCount: 0,
        igFollowDiscountCents: 0n,
      };
    }
    const welcomeK =
      welcomeDiscount.available && welcomeDiscountEligible(fulfillment)
        ? welcomeDiscount.drinksRemaining
        : 0;
    const igK = igFollowDiscount.available
      ? igFollowDiscount.drinksRemaining
      : 0;
    const { welcomeCups, igFollowCups } = pickPromoCups({
      unitPrices: sortedUnitPrices,
      welcomeK,
      igFollowK: igK,
      loyaltyRewardCount: rewardCount,
    });
    const welcomeDiscountCents =
      welcomeCups.length > 0
        ? (welcomeCups.reduce((s, p) => s + p, 0n) *
            BigInt(welcomeDiscount.percentage || 30)) /
          100n
        : 0n;
    const igFollowDiscountCents =
      igFollowCups.length > 0
        ? (igFollowCups.reduce((s, p) => s + p, 0n) *
            BigInt(igFollowDiscount.percentage || 10)) /
          100n
        : 0n;
    return {
      welcomeCount: welcomeCups.length,
      welcomeDiscountCents,
      igFollowCount: igFollowCups.length,
      igFollowDiscountCents,
    };
  }, [sortedUnitPrices, rewardCount, welcomeDiscount, igFollowDiscount, fulfillment]);
  const welcomeDiscountAmount = promoCoverage.welcomeDiscountCents;
  const igFollowDiscountAmount = promoCoverage.igFollowDiscountCents;

  // Membership tier — derived from lifetime points, never stored.
  const tier = tierFor(loyalty?.lifetimePoints ?? 0);

  // Diamond only: how many free paid-topping units remain this month.
  const [toppingsRemaining, setToppingsRemaining] = useState(0);
  useEffect(() => {
    if (tier !== "diamond") return;
    const controller = new AbortController();
    fetch("/api/tier/toppings", { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && typeof j.remaining === "number") {
          setToppingsRemaining(j.remaining);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [tier]);

  // Build CupRecord[] from cart lines — mirrors server's per-cup expansion.
  // unitPrice = variation + all modifiers (same as lineUnitPrice).
  // toppingPrices = each modifier's priceCents (0n = included, filtered by
  // collectPaidToppingUnits). Repeated once per quantity unit.
  const cups = useMemo<CupRecord[]>(() => {
    const result: CupRecord[] = [];
    for (const line of lines) {
      const unitPrice = lineUnitPrice(line);
      const toppingPrices = line.modifiers.map((m) => m.priceCents);
      for (let i = 0; i < line.quantity; i++) {
        result.push({ unitPrice, toppingPrices });
      }
    }
    return result;
  }, [lines]);

  // Preview the tier discount + diamond free-topping coverage, mirroring
  // the server's math in /api/orders so the displayed total equals the charge.
  const tierPreview = useMemo(
    () =>
      tierCheckoutPreview({
        tier,
        cups,
        rewardCount,
        toppingsRemaining,
        subtotal,
        rewardDiscount,
        welcomeDiscount: welcomeDiscountAmount,
        igFollowDiscount: igFollowDiscountAmount,
      }),
    [tier, cups, rewardCount, toppingsRemaining, subtotal, rewardDiscount, welcomeDiscountAmount, igFollowDiscountAmount],
  );

  // Card surcharge mirrors the Square service charge attached in
  // /api/orders: 1.9% of the pre-discount subtotal, SUBTOTAL_PHASE.
  const surchargeAmount = useMemo(() => cardSurcharge(subtotal), [subtotal]);

  // Platform Fee mirrors the SUBTOTAL_PHASE service charge attached in
  // /api/orders: 0.5% of the pre-discount subtotal.
  const platformFeeAmount = useMemo(() => platformFee(subtotal), [subtotal]);

  // Every cup must have a *resolved* label selection before the user
  // can pay. Two failure modes this guards against:
  //   1. Empty slot — auto-random useEffect hasn't filled it yet
  //      (manifest still loading). Without the gate, a rapid pay-click
  //      ships no presetStickerHashes / aiDoodleIds and the server
  //      silently falls back to the small POOL default (boba_eyes
  //      etc), bypassing the 78-sticker gallery.
  //   2. AI submission in flight — `{ kind:"ai", aiDoodleId:null }` is
  //      the optimistic-close marker before the background
  //      submitAiCupLabel resolves. buildPaymentSelections skips null
  //      aiDoodleId so the server again falls back to default. We
  //      want the user to actually print their AI image, so block Pay
  //      until the real uuid lands on the cart.
  const cupLabelGate = useMemo(() => {
    const sels = lines.flatMap((line) =>
      Array.from({ length: line.quantity }, (_, i) => labelSelections[cupKey(line.id, i)]),
    );
    return computeCupLabelGate(sels);
  }, [lines, labelSelections]);
  const allCupsLabeled = cupLabelGate === "ready";

  // True iff at least one cup carries a committed customer choice — exactly
  // the union buildPaymentSelections forwards to the server (so the keepsake
  // toggle appears precisely when ≥1 cup will print a keepsake). In-flight
  // null-id selections are excluded, same as the server's fall-back path.
  const hasAnyCustomizedCup = useMemo(() => {
    const { presetStickerHashes, aiDoodleIds, doodleIds } =
      buildPaymentSelections(labelSelections);
    return Boolean(presetStickerHashes || aiDoodleIds || doodleIds);
  }, [labelSelections]);

  // PH surcharge — checked client-side only for display; server is authoritative.
  // Re-check every 60s so a user sitting on the checkout page across the Christmas
  // Eve 18:00 cutoff (or any midnight boundary) sees the correct total before submitting.
  const [phActive, setPhActive] = useState(() => isPublicHolidayActive());
  useEffect(() => {
    const id = setInterval(() => setPhActive(isPublicHolidayActive()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Re-check delivery hours every 60s so a session stays accurate across the
  // 11:00 / 21:30 boundaries.
  useEffect(() => {
    const id = setInterval(() => setHoursOpen(isDeliveryHoursOpen()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Trigger quote when address + lat/lng + phone are populated and we're in DELIVERY mode.
  useEffect(() => {
    if (fulfillment !== "DELIVERY") {
      setQuoteState({ kind: "idle" });
      return;
    }
    if (!deliveryAddress.lat || !deliveryAddress.lng || !deliveryAddress.address) {
      setQuoteState({ kind: "idle" });
      return;
    }
    if (!deliveryAddress.postcode) {
      setQuoteState({ kind: "error", message: "Enter your delivery postcode" });
      return;
    }
    if (!isDeliverablePostcode(deliveryAddress.postcode)) {
      setQuoteState({ kind: "error", message: "Sorry, we don't deliver to that postcode" });
      return;
    }
    if (!hoursOpen) {
      setQuoteState({ kind: "error", message: "Delivery hours: 10:30am–10:30pm" });
      return;
    }
    if (!isDeliveryEligible(subtotal)) {
      setQuoteState({ kind: "error", message: "Add more to qualify for delivery" });
      return;
    }
    setQuoteState({ kind: "loading" });
    let cancelled = false;
    fetch("/api/delivery/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: deliveryAddress.address,
        lat: deliveryAddress.lat,
        lng: deliveryAddress.lng,
        unit: deliveryAddress.unit,
        driverNote: deliveryAddress.driverNote,
        postcode: deliveryAddress.postcode,
        drinksSubtotalCents: Number(subtotal),
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.ok) {
          setQuoteState({ kind: "ok", feeCents: data.feeCents, serviceFeeCents: data.serviceFeeCents });
        } else {
          const map: Record<string, string> = {
            out_of_zone: "Sorry, we don't deliver to that postcode",
            closed: "Delivery hours: 10:30am–10:30pm",
            min_order: "Add more to qualify for delivery",
            auth: "Sign in to get a delivery quote",
            invalid_body: "Address looks invalid — try a fuller address",
            invalid_json: "Address looks invalid — try a fuller address",
          };
          setQuoteState({ kind: "error", message: map[data.reason] ?? "Delivery unavailable" });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setQuoteState({ kind: "error", message: "Couldn't reach delivery service" });
      });
    return () => { cancelled = true; };
  }, [fulfillment, deliveryAddress, hoursOpen, subtotal]);

  // Ordering window — poll /api/store-status every 30s so the Place Order
  // button flips at the 22:15 cutoff (or pos_backup_mode toggle) without
  // needing a page reload. Server gates the actual order in /api/orders.
  const [orderingStatus, setOrderingStatus] = useState<OrderingStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const res = await fetch("/api/store-status", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as OrderingStatus;
        if (!cancelled) setOrderingStatus(data);
      } catch {
        /* keep last-known good value */
      }
    }
    pull();
    const id = setInterval(pull, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  const orderingKnown = orderingStatus !== null;
  const orderingOpen = orderingStatus?.open === true;
  // Pre-fetch: treat as open so we don't flash a "closed" state on first
  // paint. The server gate is still authoritative.
  const storeClosed = orderingKnown && !orderingOpen;
  const phSurchargeAmount = useMemo(
    () => (phActive ? publicHolidaySurcharge(subtotal) : 0n),
    [phActive, subtotal],
  );

  // Delivery + service fees — only displayed (and added to total) when DELIVERY is chosen.
  // The delivery fee is distance-based, so the client cannot recompute it (no distance
  // here). We mirror the authoritative amounts the server returned in the quote; until a
  // valid quote resolves there is no fee to show.
  const deliveryFeeAmount = useMemo(
    () =>
      fulfillment === "DELIVERY" && quoteState.kind === "ok"
        ? BigInt(quoteState.feeCents)
        : 0n,
    [fulfillment, quoteState],
  );
  const serviceFeeAmount = useMemo(
    () =>
      fulfillment === "DELIVERY" && quoteState.kind === "ok"
        ? BigInt(quoteState.serviceFeeCents)
        : 0n,
    [fulfillment, quoteState],
  );

  const starsPerReward = authStarsPerReward || LOYALTY.starsPerReward;
  const loyaltyBalance = loyalty?.balance ?? 0;
  const starsThisOrder = lines.reduce((n, l) => n + l.quantity, 0);
  const progressPct = Math.min((loyaltyBalance / starsPerReward) * 100, 100);

  // Maximum rewards the user can apply — bounded by stars balance and cup count.
  const cupCount = starsThisOrder; // 1 cup per quantity unit
  const maxRewardCount = useMemo(() => {
    if (starsPerReward <= 0) return 0;
    return Math.min(
      Math.floor(loyaltyBalance / starsPerReward),
      cupCount,
    );
  }, [loyaltyBalance, starsPerReward, cupCount]);

  // Clamp rewardCount if maxRewardCount shrinks (e.g. user removes an item).
  useEffect(() => {
    if (rewardCount > maxRewardCount) setRewardCount(maxRewardCount);
  }, [maxRewardCount, rewardCount]);

  // True reward redemption path — server skips the card surcharge and
  // client skips tokenization entirely because Square's total comes out
  // to $0 after the reward discount.
  const totalDiscount =
    rewardDiscount + welcomeDiscountAmount + igFollowDiscountAmount +
    tierPreview.toppingCoveredCents + tierPreview.tierDiscountCents;
  const afterDiscount =
    subtotal - totalDiscount > 0n ? subtotal - totalDiscount : 0n;
  const isFreeRedeem = rewardCount > 0 && afterDiscount === 0n;

  const displayTotal = useMemo(() => {
    if (isFreeRedeem) return 0n;
    return afterDiscount + surchargeAmount + platformFeeAmount + phSurchargeAmount + deliveryFeeAmount + serviceFeeAmount;
  }, [
    isFreeRedeem,
    afterDiscount,
    surchargeAmount,
    platformFeeAmount,
    phSurchargeAmount,
    deliveryFeeAmount,
    serviceFeeAmount,
  ]);
  // Hide the surcharge lines from the order summary when the reward
  // will cover the order — the backend won't charge them.
  const effectiveSurcharge = isFreeRedeem ? 0n : surchargeAmount;
  const effectivePlatformFee = isFreeRedeem ? 0n : platformFeeAmount;
  const effectivePhSurcharge = isFreeRedeem ? 0n : phSurchargeAmount;
  const effectiveDeliveryFee = isFreeRedeem ? 0n : deliveryFeeAmount;
  const effectiveServiceFee = isFreeRedeem ? 0n : serviceFeeAmount;

  // DELIVERY selected but no authoritative quote yet (address incomplete, out
  // of zone, outside hours, or signed out) → deliveryFee/serviceFee both fall
  // back to 0n. Render a pending "—" instead of a misleading "FREE" / "$0.00":
  // delivery is NOT actually free until a quote confirms it. Free-redeem orders
  // are genuinely $0, so they bypass the pending state.
  const deliveryFeesPending =
    fulfillment === "DELIVERY" && !isFreeRedeem && quoteState.kind !== "ok";

  useEffect(() => {
    if (applePayAvailable) setPayMethod("apple");
    else if (googlePayAvailable) setPayMethod("google");
  }, [applePayAvailable, googlePayAvailable]);

  // When the reward fully covers the order, no card is charged so the
  // card form can stay unmounted.
  const needsCard = !isFreeRedeem;

  // Initialize the Square card form once the SDK has loaded AND the
  // #card-container element is in the DOM.
  useEffect(() => {
    if (!needsCard) {
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

  // Initialize Apple Pay.
  useEffect(() => {
    if (!cardReady || !needsCard) return;
    if (applePayRef.current) return;

    let cancelled = false;
    (async () => {
      try {
        const payments = paymentsRef.current;
        if (!payments) return;

        const paymentRequest = payments.paymentRequest({
          countryCode: "AU",
          currencyCode: "AUD",
          total: {
            amount: (Number(displayTotal) / 100).toFixed(2),
            label: BRAND.name,
          },
        });
        applePayRequestRef.current = paymentRequest;
        const ap = await payments.applePay(paymentRequest);
        if (cancelled) return;
        applePayRef.current = ap;
        setApplePayAvailable(true);
      } catch (err) {
        console.info("[apple-pay]", err instanceof Error ? err.message : err);
      }
    })();

    return () => {
      cancelled = true;
      applePayRef.current = null;
      applePayRequestRef.current = null;
      setApplePayAvailable(false);
    };
  }, [cardReady, needsCard]);

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
            amount: (Number(displayTotal) / 100).toFixed(2),
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
  }, [sdkReady, needsCard, cardReady, displayTotal]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!profile) return;
    setError(null);
    setPaymentError(null);

    // Defense in depth — button is already disabled when storeClosed,
    // but a stale render could still fire onSubmit. Server is authoritative.
    if (storeClosed) {
      setError(`Orders closed · ${orderingStatus?.nextLabel ?? ""}`);
      return;
    }

    const expectFreeOrder = isFreeRedeem;
    if (!expectFreeOrder) {
      if (payMethod === "apple") {
        if (!applePayRef.current) {
          setError("Apple Pay is not ready yet.");
          return;
        }
      } else if (payMethod === "google") {
        if (!googlePayRef.current) {
          setError("Google Pay is not ready yet.");
          return;
        }
      } else if (!cardRef.current) {
        setError("Card form is not ready yet.");
        return;
      }
    }

    setSubmitting(true);
    let step = "start";
    let createdOrderId: string | undefined;
    try {
      // 0) Tokenize wallet IMMEDIATELY — must stay in the user-gesture frame.
      let sourceToken: string | undefined;
      if (!expectFreeOrder && (payMethod === "apple" || payMethod === "google")) {
        step = "tokenize-wallet";
        const walletInstance = payMethod === "apple"
          ? applePayRef.current
          : googlePayRef.current;
        if (!walletInstance) throw new Error("Wallet payment is not ready.");
        if (payMethod === "apple" && applePayRequestRef.current?.update) {
          applePayRequestRef.current.update({
            total: {
              amount: (Number(displayTotal) / 100).toFixed(2),
              label: BRAND.name,
            },
          });
        }
        const tokenResult = await walletInstance.tokenize();
        if (tokenResult.status !== "OK" || !tokenResult.token) {
          const detail =
            tokenResult.errors?.[0]?.message ??
            `Tokenization failed (${tokenResult.status})`;
          throw new Error(detail);
        }
        sourceToken = tokenResult.token;
      }

      // 1) Create the order. The server derives customer/phone/name
      // from the Supabase session — no need to send them.
      step = "create-order";
      const orderRes = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: note.trim() || undefined,
          applyWelcomeDiscount:
            welcomeDiscount.available && welcomeDiscountEligible(fulfillment),
          applyIgFollowDiscount: igFollowDiscount.available,
          applyLoyaltyReward: rewardCount > 0,
          loyaltyRewardCount: rewardCount,
          fulfillmentType: fulfillment,
          delivery:
            fulfillment === "DELIVERY" && quoteState.kind === "ok"
              ? {
                  address: deliveryAddress.address,
                  lat: deliveryAddress.lat,
                  lng: deliveryAddress.lng,
                  unit: deliveryAddress.unit || undefined,
                  driverNote: deliveryAddress.driverNote || undefined,
                  postcode: deliveryAddress.postcode,
                }
              : undefined,
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
      createdOrderId = orderJson.orderId;

      // 2) Optionally redeem loyalty rewards against the order.
      let amountCents: string = orderJson.amountCents;
      if (rewardCount > 0) {
        step = "redeem";
        const redeemRes = await fetch("/api/loyalty/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: orderJson.orderId, count: rewardCount }),
        });
        const redeemJson = await redeemRes.json();
        if (!redeemRes.ok || !redeemJson.ok) {
          throw new Error(redeemJson.error ?? "Could not redeem reward");
        }
        if (typeof redeemJson.updatedAmountCents === "string") {
          amountCents = redeemJson.updatedAmountCents;
        }
      }

      // 3) Tokenize card (if applicable) + verifyBuyer.
      const isFreeOrder = amountCents === "0" || Number(amountCents) === 0;

      let verificationToken: string | undefined;
      if (!isFreeOrder) {
        if (payMethod === "card") {
          if (!cardRef.current) throw new Error("Card form is not ready yet.");
          step = "tokenize-card";
          const tokenResult = await cardRef.current.tokenize();
          if (tokenResult.status !== "OK" || !tokenResult.token) {
            const detail =
              tokenResult.errors?.[0]?.message ??
              `Tokenization failed (${tokenResult.status})`;
            throw new Error(detail);
          }
          sourceToken = tokenResult.token;
        }

        if (!paymentsRef.current) {
          throw new Error("Payments SDK not initialized");
        }
        if (!sourceToken) {
          throw new Error("No payment token available");
        }
        const amountMajor = (Number(amountCents) / 100).toFixed(2);
        const givenName = profile.first_name ?? "";
        const familyName = profile.last_name ?? "";
        step = "verifyBuyer";
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

      // 4) Finalize the order. buildPaymentRequestBody bakes the per-cup
      //    label selections (preset | photo | ai | draw) into the body via
      //    buildPaymentSelections. Shared with the cart drawer's wallet-pay
      //    handler so neither path can drop the selections (the OL829 bug).
      //    Empty buckets stay `undefined` so the server enqueue falls back
      //    to hash-default for slots without an explicit choice.
      step = "payment";
      const paymentRes = await fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildPaymentRequestBody({
            sourceId: sourceToken,
            orderId: orderJson.orderId,
            verificationToken,
            labelSelections,
            keepLabelCopy,
          }),
        ),
      });
      const paymentJson = await paymentRes.json();
      if (!paymentRes.ok || !paymentJson.ok) {
        throw new Error(paymentJson.error ?? "Payment failed");
      }

      if (
        paymentJson.welcomeDiscountConsumed ||
        paymentJson.igFollowDiscountConsumed
      ) {
        void refresh();
      }

      clear();
      router.push(`/order-confirmation/${orderJson.orderId}`);
    } catch (err) {
      const described = describeError(err);
      reportClientError({
        scope: "checkout",
        step,
        message: described.message,
        meta: {
          name: described.name,
          squareErrors: described.squareErrors,
          payMethod,
          createdOrderId,
          expectFreeOrder,
          sdkReady,
        },
      });
      // Delivery eligibility gates (minimum order, hours, zone, address) are
      // not payment failures — show an actionable dialog instead of "Retry".
      const block = classifyOrderBlock(described.message, subtotal);
      if (block) {
        setOrderBlock(block);
      } else {
        setPaymentError(described.message);
      }
      setSubmitting(false);
    }
  }

  const displayName =
    [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
    "Signed-in customer";

  return (
    <CheckoutFrame>
      <Script
        src={WEB_SDK_SRC}
        strategy="afterInteractive"
        onReady={() => setSdkReady(true)}
      />

      <PickupReminderDialog />

      <PaymentErrorDialog
        open={!!paymentError}
        message={paymentError}
        onCancel={() => setPaymentError(null)}
        onRetry={() => {
          setPaymentError(null);
          handleSubmit({ preventDefault: () => {} } as unknown as React.FormEvent);
        }}
      />

      <OrderBlockedDialog
        open={!!orderBlock}
        title={orderBlock?.title ?? ""}
        body={orderBlock?.body ?? ""}
        onAddItems={
          orderBlock?.canAddItems
            ? () => {
                setOrderBlock(null);
                router.push("/menu");
              }
            : undefined
        }
        onSwitchToPickup={
          orderBlock?.canSwitchToPickup
            ? () => {
                setOrderBlock(null);
                setFulfillment("PICKUP");
              }
            : undefined
        }
        onCancel={() => setOrderBlock(null)}
      />

      <form
        id="checkout-form"
        onSubmit={handleSubmit}
        noValidate
        className="grid gap-5 sm:gap-8 lg:grid-cols-[1fr_380px] pb-24 lg:pb-0"
      >
        {/* ── Left column ── */}
        <div className="min-w-0 space-y-5 sm:space-y-6">
          {/* Fulfillment + delivery quote */}
          <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
            <SectionLabel>Fulfillment</SectionLabel>
            <div className="mt-3.5">
              <FulfillmentSelector
                value={fulfillment}
                onChange={setFulfillment}
                drinksSubtotalCents={subtotal}
              />
            </div>

            {fulfillment === "DELIVERY" && (
              <div className="mt-4 space-y-3">
                <DeliveryAddressForm
                  value={deliveryAddress}
                  onChange={setDeliveryAddress}
                  defaultPhone={profile.phone_e164}
                />
                <DeliveryQuoteCard state={quoteState} />
              </div>
            )}
          </section>

          {/* Rewards Progress */}
          <section
            className="relative overflow-hidden rounded-2xl p-4 sm:p-5"
            style={{ backgroundColor: BRAND.accentColor }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-ink sm:text-base">
                  Rewards Progress
                </h3>
                <p className="mt-0.5 text-xs text-ink2 sm:mt-1 sm:text-sm">
                  {loyaltyBalance > 0
                    ? `${loyaltyBalance} stars · +${starsThisOrder} this order`
                    : `+${starsThisOrder} star${starsThisOrder !== 1 ? "s" : ""} this order`}
                </p>
              </div>
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white sm:h-9 sm:w-9"
                style={{ backgroundColor: BRAND.primaryColor }}
              >
                <StarIcon />
              </span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/60 sm:mt-4 sm:h-2.5">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${progressPct}%`,
                  backgroundColor: BRAND.primaryColor,
                }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-ink3 sm:mt-2 sm:text-[11px]">
              <span>{loyaltyBalance} Stars</span>
              <span>{starsPerReward} for Free Drink</span>
            </div>

            {maxRewardCount > 0 && (
              <div
                className="mt-2.5 flex items-center justify-between rounded-lg border px-4 py-3 sm:mt-3"
                style={{
                  borderColor: `${BRAND.primaryColor}4D`, // 30% alpha
                  backgroundColor: `${BRAND.accentColor}66`, // ~40% alpha
                }}
              >
                <div>
                  <div
                    className="text-sm font-medium"
                    style={{ color: BRAND.primaryColor }}
                  >
                    Use rewards
                  </div>
                  {rewardCount > 0 && (
                    <div className="mt-0.5 text-xs text-neutral-600">
                      −{formatPrice(rewardDiscount)} off {rewardCount} cheapest drink
                      {rewardCount > 1 ? "s" : ""}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setRewardCount((n) => Math.max(0, n - 1))}
                    disabled={rewardCount === 0}
                    className="h-8 w-8 rounded-full border disabled:opacity-30"
                    style={{ borderColor: BRAND.primaryColor, color: BRAND.primaryColor }}
                    aria-label="Decrease reward count"
                  >
                    <span aria-hidden="true">−</span>
                  </button>
                  <span
                    className="min-w-[1.5rem] text-center font-medium"
                    style={{ color: BRAND.primaryColor }}
                  >
                    {rewardCount}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setRewardCount((n) => Math.min(maxRewardCount, n + 1))
                    }
                    disabled={rewardCount === maxRewardCount}
                    className="h-8 w-8 rounded-full border disabled:opacity-30"
                    style={{ borderColor: BRAND.primaryColor, color: BRAND.primaryColor }}
                    aria-label="Increase reward count"
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ── Mobile: Order Summary (collapsible) ── */}
          <section className="lg:hidden">
            <details className="rounded-2xl border border-line bg-white" open>
              <summary className="flex cursor-pointer items-center justify-between p-4 text-sm font-bold text-ink">
                <span>Order Summary ({lines.length} item{lines.length !== 1 ? "s" : ""})</span>
                <span className="font-bold" style={{ color: BRAND.primaryColor }}>
                  {formatPrice(displayTotal)}
                </span>
              </summary>
              <div className="border-t border-line p-4">
                <ul className="space-y-4">
                  {lines.map((line) => (
                    <SummaryRow key={line.id} line={line} />
                  ))}
                </ul>

                <div className="mt-4 space-y-3 border-t border-line pt-4">
                  <div className="flex justify-between text-sm text-ink2">
                    <span>Subtotal</span>
                    <span className="font-semibold text-ink">
                      {formatPrice(subtotal)}
                    </span>
                  </div>
                  {welcomeDiscount.available && promoCoverage.welcomeCount > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: BRAND.primaryColor }}
                        />
                        Welcome {welcomeDiscount.percentage}% Off
                        <span className="text-xs text-ink3">
                          ({promoCoverage.welcomeCount} drink
                          {promoCoverage.welcomeCount === 1 ? "" : "s"})
                        </span>
                      </span>
                      <span style={{ color: BRAND.primaryColor }}>
                        −{formatPrice(welcomeDiscountAmount)}
                      </span>
                    </div>
                  )}
                  {igFollowDiscount.available && promoCoverage.igFollowCount > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: BRAND.primaryColor }}
                        />
                        IG Follow {igFollowDiscount.percentage || 10}% Off
                        <span className="text-xs text-ink3">
                          ({promoCoverage.igFollowCount} drink
                          {promoCoverage.igFollowCount === 1 ? "" : "s"})
                        </span>
                      </span>
                      <span style={{ color: BRAND.primaryColor }}>
                        −{formatPrice(igFollowDiscountAmount)}
                      </span>
                    </div>
                  )}
                  {rewardCount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="font-semibold" style={{ color: BRAND.primaryColor }}>
                        Loyalty reward{rewardCount > 1 ? ` ×${rewardCount}` : ""}
                      </span>
                      <span className="font-semibold" style={{ color: BRAND.primaryColor }}>
                        −{formatPrice(rewardDiscount)}
                      </span>
                    </div>
                  )}
                  {tierPreview.toppingCoveredCents > 0n && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: BRAND.primaryColor }}
                        />
                        Free toppings ×{tierPreview.toppingCoveredCount} ({toppingsRemaining} left this month)
                      </span>
                      <span style={{ color: BRAND.primaryColor }}>
                        −{formatPrice(tierPreview.toppingCoveredCents)}
                      </span>
                    </div>
                  )}
                  {tierPreview.tierDiscountCents > 0n && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: BRAND.primaryColor }}
                        />
                        {tier === "diamond" ? "Diamond" : "Gold"} Member −5%
                      </span>
                      <span style={{ color: BRAND.primaryColor }}>
                        −{formatPrice(tierPreview.tierDiscountCents)}
                      </span>
                    </div>
                  )}
                  {fulfillment === "DELIVERY" && (
                    <>
                      <div className="flex justify-between text-sm text-ink2">
                        <span>{DELIVERY_FEE_NAME}</span>
                        <span className="font-semibold text-ink">
                          {deliveryFeesPending ? (
                            <span className="text-ink4">—</span>
                          ) : effectiveDeliveryFee === 0n ? (
                            <span className="text-emerald-600">FREE</span>
                          ) : (
                            formatPrice(effectiveDeliveryFee)
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm text-ink2">
                        <span>
                          {SERVICE_FEE.name}{" "}
                          <span className="text-xs text-ink4">
                            ({SERVICE_FEE.percentage}%)
                          </span>
                        </span>
                        <span className="font-semibold text-ink">
                          {deliveryFeesPending ? (
                            <span className="text-ink4">—</span>
                          ) : (
                            formatPrice(effectiveServiceFee)
                          )}
                        </span>
                      </div>
                    </>
                  )}
                  {effectivePhSurcharge > 0n && (
                    <div className="flex justify-between text-sm text-ink2">
                      <span>
                        {PH_SURCHARGE.name}{" "}
                        <span className="text-xs text-ink4">
                          ({PH_SURCHARGE.percentage}%)
                        </span>
                      </span>
                      <span className="font-semibold text-ink">
                        {formatPrice(effectivePhSurcharge)}
                      </span>
                    </div>
                  )}
                  {effectivePlatformFee > 0n && (
                    <div className="flex justify-between text-sm text-ink2">
                      <span>
                        {PLATFORM_FEE.name}{" "}
                        <span className="text-xs text-ink4">
                          ({PLATFORM_FEE.percentage}%)
                        </span>
                      </span>
                      <span className="font-semibold text-ink">
                        {formatPrice(effectivePlatformFee)}
                      </span>
                    </div>
                  )}
                  {effectiveSurcharge > 0n && (
                    <div className="flex justify-between text-sm text-ink2">
                      <span>
                        {CARD_SURCHARGE.name}{" "}
                        <span className="text-xs text-ink4">
                          ({CARD_SURCHARGE.percentage}%)
                        </span>
                      </span>
                      <span className="font-semibold text-ink">
                        {formatPrice(effectiveSurcharge)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm text-ink2">
                    <span>Tax</span>
                    <span className="font-semibold text-ink">
                      Calculated at payment
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between border-t border-line pt-3">
                    <span className="text-base font-bold text-ink">Total</span>
                    <span className="text-xl font-bold text-brand">
                      {formatPrice(displayTotal)}
                    </span>
                  </div>
                </div>
              </div>
            </details>
          </section>

          {/* Free drink banner */}
          {isFreeRedeem && (
            <section
              className="rounded-2xl border-2 p-4 sm:p-5"
              style={{ borderColor: BRAND.primaryColor }}
            >
              <p
                className="text-center text-base font-bold sm:text-lg"
                style={{ color: BRAND.primaryColor }}
              >
                This drink is on us! 🎉
              </p>
              <p className="mt-1 text-center text-xs text-ink2 sm:text-sm">
                Your {starsPerReward} stars will be redeemed — no payment needed.
              </p>
            </section>
          )}

          {/* ── Cup Labels — per-cup gallery picker (web-only, gallery ship) ── */}
          <CupLabelSection />

          {/* ── Keepsake copy — free extra print of each customized cup ── */}
          {hasAnyCustomizedCup && (
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-white p-4 sm:p-5">
              <input
                type="checkbox"
                checked={keepLabelCopy}
                onChange={(e) => setKeepLabelCopy(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#C43A10]"
              />
              <span className="text-sm text-ink2">
                🎁 Print an extra copy of my custom cup design to keep
                <span className="mt-0.5 block text-xs text-ink3">
                  We&apos;ll print a spare label of each cup you customized — yours to keep.
                </span>
              </span>
            </label>
          )}

          {/* ── Your Details — signed-in summary + optional note ── */}
          <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
            <div className="mb-3 flex items-start justify-between gap-3 sm:mb-4">
              <div className="min-w-0">
                <SectionLabel>Your Details</SectionLabel>
                <p className="mt-1.5 truncate text-sm font-medium text-ink">
                  {displayName}
                </p>
                <p className="text-xs text-ink3">{profile.phone_e164}</p>
              </div>
              <span
                className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                style={{ backgroundColor: BRAND.primaryColor }}
              >
                Signed In
              </span>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-ink3">
                Order note (optional)
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Any special requests? e.g. less ice, extra boba"
                rows={2}
                className="w-full rounded-lg border border-black/15 bg-white px-4 py-3 text-sm outline-none focus:border-black/40"
              />
            </label>
          </section>

          {/* Payment Method — hidden when the reward fully covers the order */}
          {!isFreeRedeem && (
            <>
              <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
                <SectionLabel>Payment Method</SectionLabel>

                <div className="mt-3.5 flex flex-col gap-2.5 sm:gap-3">
                  {applePayAvailable && (
                    <button
                      type="button"
                      onClick={() => setPayMethod("apple")}
                      className={`flex w-full items-center justify-center gap-0.5 rounded-xl py-3 text-sm transition sm:py-3.5 sm:text-base ${
                        payMethod === "apple"
                          ? "bg-black text-white ring-2 ring-black ring-offset-2"
                          : "bg-black/85 text-white/90 hover:bg-black"
                      }`}
                    >
                      Buy with <AppleLogo className="ml-0.5 -mt-0.5" /><span className="font-semibold">Pay</span>
                    </button>
                  )}

                  {googlePayAvailable && (
                    <button
                      type="button"
                      onClick={() => setPayMethod("google")}
                      className={`flex w-full items-center justify-center gap-1 rounded-xl py-3 text-sm transition sm:py-3.5 sm:text-base ${
                        payMethod === "google"
                          ? "bg-[#3c4043] text-white ring-2 ring-[#3c4043] ring-offset-2"
                          : "bg-[#3c4043]/85 text-white/90 hover:bg-[#3c4043]"
                      }`}
                    >
                      Buy with <GoogleGLogo /> <span className="font-semibold">Pay</span>
                    </button>
                  )}

                  {walletAvailable && (
                    <button
                      type="button"
                      onClick={() => setPayMethod("card")}
                      className="flex w-full items-center justify-center gap-1.5 rounded-full border-2 py-2.5 text-sm font-semibold transition sm:py-3"
                      style={
                        payMethod === "card"
                          ? { borderColor: BRAND.primaryColor, color: BRAND.primaryColor }
                          : { borderColor: "rgba(0,0,0,0.15)", color: "#71717a" }
                      }
                    >
                      <CardIcon /> Pay with Card
                    </button>
                  )}
                </div>
              </section>

              {(payMethod === "apple" || payMethod === "google") && walletAvailable && (
                <p className="text-xs text-ink4">
                  Click &quot;{payMethod === "apple" ? "Pay with Apple Pay" : "Pay with Google Pay"}&quot; below to complete your order.
                </p>
              )}

              <div id="google-pay-container" className="absolute h-0 w-0 overflow-hidden opacity-0 pointer-events-none" />

              <section
                className="rounded-2xl border border-line bg-white p-4 sm:p-5"
                style={{ display: payMethod === "card" ? undefined : "none" }}
              >
                <div>
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-ink3">
                    Card Details
                  </span>
                  {SQUARE_ENV !== "production" && (
                    <p className="mb-2 text-[10px] text-ink4">
                      Sandbox: <code>4111 1111 1111 1111</code> · 12/27 · 111 · 4215
                    </p>
                  )}
                  <div
                    id="card-container"
                    className="min-h-[90px] rounded-lg border border-black/15 bg-white px-3 py-2"
                  />
                  {!cardReady && (
                    <p className="mt-2 text-xs text-ink4">
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

        {/* ── Right column: Order Summary (desktop) ── */}
        <section className="hidden rounded-2xl border border-line bg-card p-4 sm:p-6 lg:block lg:sticky lg:top-6 lg:self-start">
          <h2 className="mb-4 font-serif text-xl font-semibold tracking-[-0.02em] text-ink sm:mb-5">
            Order summary
          </h2>

          <ul className="space-y-5">
            {lines.map((line) => (
              <SummaryRow key={line.id} line={line} />
            ))}
          </ul>

          <div className="mt-6 space-y-3 border-t border-line pt-5">
            <div className="flex justify-between text-sm text-ink2">
              <span>Subtotal</span>
              <span className="font-semibold text-ink">
                {formatPrice(subtotal)}
              </span>
            </div>
            {welcomeDiscount.available && promoCoverage.welcomeCount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: BRAND.primaryColor }}
                  />
                  Welcome {welcomeDiscount.percentage}% Off
                  <span className="text-xs text-ink3">
                    ({promoCoverage.welcomeCount} drink
                    {promoCoverage.welcomeCount === 1 ? "" : "s"})
                  </span>
                </span>
                <span style={{ color: BRAND.primaryColor }}>
                  −{formatPrice(welcomeDiscountAmount)}
                </span>
              </div>
            )}
            {igFollowDiscount.available && promoCoverage.igFollowCount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: BRAND.primaryColor }}
                  />
                  IG Follow {igFollowDiscount.percentage || 10}% Off
                  <span className="text-xs text-ink3">
                    ({promoCoverage.igFollowCount} drink
                    {promoCoverage.igFollowCount === 1 ? "" : "s"})
                  </span>
                </span>
                <span style={{ color: BRAND.primaryColor }}>
                  −{formatPrice(igFollowDiscountAmount)}
                </span>
              </div>
            )}
            {rewardCount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="font-semibold" style={{ color: BRAND.primaryColor }}>
                  Loyalty reward{rewardCount > 1 ? ` ×${rewardCount}` : ""}
                </span>
                <span className="font-semibold" style={{ color: BRAND.primaryColor }}>
                  −{formatPrice(rewardDiscount)}
                </span>
              </div>
            )}
            {tierPreview.toppingCoveredCents > 0n && (
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: BRAND.primaryColor }}
                  />
                  Free toppings ×{tierPreview.toppingCoveredCount} ({toppingsRemaining} left this month)
                </span>
                <span style={{ color: BRAND.primaryColor }}>
                  −{formatPrice(tierPreview.toppingCoveredCents)}
                </span>
              </div>
            )}
            {tierPreview.tierDiscountCents > 0n && (
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: BRAND.primaryColor }}
                  />
                  {tier === "diamond" ? "Diamond" : "Gold"} Member −5%
                </span>
                <span style={{ color: BRAND.primaryColor }}>
                  −{formatPrice(tierPreview.tierDiscountCents)}
                </span>
              </div>
            )}
            {fulfillment === "DELIVERY" && (
              <>
                <div className="flex justify-between text-sm text-ink2">
                  <span>{DELIVERY_FEE_NAME}</span>
                  <span className="font-semibold text-ink">
                    {deliveryFeesPending ? (
                      <span className="text-ink4">—</span>
                    ) : effectiveDeliveryFee === 0n ? (
                      <span className="text-emerald-600">FREE</span>
                    ) : (
                      formatPrice(effectiveDeliveryFee)
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-sm text-ink2">
                  <span>
                    {SERVICE_FEE.name}{" "}
                    <span className="text-xs text-ink4">
                      ({SERVICE_FEE.percentage}%)
                    </span>
                  </span>
                  <span className="font-semibold text-ink">
                    {deliveryFeesPending ? (
                      <span className="text-ink4">—</span>
                    ) : (
                      formatPrice(effectiveServiceFee)
                    )}
                  </span>
                </div>
              </>
            )}
            {effectivePhSurcharge > 0n && (
              <div className="flex justify-between text-sm text-ink2">
                <span>
                  {PH_SURCHARGE.name}{" "}
                  <span className="text-xs text-ink4">
                    ({PH_SURCHARGE.percentage}%)
                  </span>
                </span>
                <span className="font-semibold text-ink">
                  {formatPrice(effectivePhSurcharge)}
                </span>
              </div>
            )}
            {effectivePlatformFee > 0n && (
              <div className="flex justify-between text-sm text-ink2">
                <span>
                  {PLATFORM_FEE.name}{" "}
                  <span className="text-xs text-ink4">
                    ({PLATFORM_FEE.percentage}%)
                  </span>
                </span>
                <span className="font-semibold text-ink">
                  {formatPrice(effectivePlatformFee)}
                </span>
              </div>
            )}
            {effectiveSurcharge > 0n && (
              <div className="flex justify-between text-sm text-ink2">
                <span>
                  {CARD_SURCHARGE.name}{" "}
                  <span className="text-xs text-ink4">
                    ({CARD_SURCHARGE.percentage}%)
                  </span>
                </span>
                <span className="font-semibold text-ink">
                  {formatPrice(effectiveSurcharge)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm text-ink2">
              <span>Tax</span>
              <span className="font-semibold text-ink">
                Calculated at payment
              </span>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <span className="text-base font-bold text-ink">Total</span>
              <span className="text-2xl font-bold text-brand">
                {formatPrice(displayTotal)}
              </span>
            </div>
          </div>

          <button
            type="submit"
            disabled={
              submitting ||
              storeClosed ||
              !allCupsLabeled ||
              (!isFreeRedeem &&
                (payMethod === "card" ? !cardReady
                  : payMethod === "apple" ? !applePayAvailable
                  : !googlePayAvailable)) ||
              (fulfillment === "DELIVERY" && quoteState.kind !== "ok")
            }
            className="mt-6 flex w-full items-center justify-center gap-1 rounded-full py-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={
              storeClosed
                ? { backgroundColor: "#a1a1aa" }
                : payMethod === "apple"
                  ? { backgroundColor: "#000000" }
                  : payMethod === "google"
                    ? { backgroundColor: "#1a1a1a" }
                    : { backgroundColor: BRAND.primaryColor }
            }
          >
            {storeClosed
              ? `Orders closed · ${orderingStatus?.nextLabel ?? ""}`
              : submitting
                ? "Processing…"
                : !allCupsLabeled
                  ? (cupLabelGate === "ai-pending"
                      ? "Waiting for AI image…"
                      : cupLabelGate === "draw-pending"
                        ? "Saving your drawing…"
                        : "Preparing labels…")
                  : isFreeRedeem
                    ? "Redeem Free Drink"
                    : payMethod === "apple"
                      ? <><span>Pay with</span> <AppleLogo className="ml-0.5 -mt-0.5" /><span className="font-semibold">Pay</span></>
                      : payMethod === "google"
                        ? <><span>Pay with</span> <GoogleGLogo /> <span className="font-semibold">Pay</span></>
                        : cardReady
                          ? `Pay ${formatPrice(displayTotal)}`
                          : "Loading payment…"}
          </button>

          <p className="mt-3 text-center text-xs text-ink3">
            You&apos;ll earn {starsThisOrder} ⭐ on this order
          </p>
          <p className="mt-2 text-center text-[11px] text-ink4">
            By placing your order, you agree to Mandy&apos;s{" "}
            <a href="#" className="underline">Terms of Service</a>{" "}
            and <a href="#" className="underline">Privacy Policy</a>.
          </p>
        </section>
      </form>

      {/* ── Mobile sticky bottom bar ── */}
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-white px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-2px_10px_rgba(0,0,0,0.08)] lg:hidden">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-ink3">Total</p>
            <p className="text-lg font-bold text-ink">
              {formatPrice(displayTotal)}
            </p>
            {welcomeDiscount.available && promoCoverage.welcomeCount > 0 && (
              <p className="truncate text-[11px] font-semibold" style={{ color: BRAND.primaryColor }}>
                Welcome {welcomeDiscount.percentage}% Off ·{" "}
                {promoCoverage.welcomeCount} drink
                {promoCoverage.welcomeCount === 1 ? "" : "s"} · −
                {formatPrice(welcomeDiscountAmount)}
              </p>
            )}
            {igFollowDiscount.available && promoCoverage.igFollowCount > 0 && (
              <p className="truncate text-[11px] font-semibold" style={{ color: BRAND.primaryColor }}>
                IG Follow {igFollowDiscount.percentage || 10}% Off ·{" "}
                {promoCoverage.igFollowCount} drink
                {promoCoverage.igFollowCount === 1 ? "" : "s"} · −
                {formatPrice(igFollowDiscountAmount)}
              </p>
            )}
            {effectiveSurcharge > 0n && (
              <p className="truncate text-[11px] text-ink3">
                {effectivePhSurcharge > 0n && (
                  <>Incl. {PH_SURCHARGE.name} {formatPrice(effectivePhSurcharge)} · </>
                )}
                {effectivePlatformFee > 0n && (
                  <>Incl. {PLATFORM_FEE.name} {formatPrice(effectivePlatformFee)} · </>
                )}
                Incl. {CARD_SURCHARGE.name} {formatPrice(effectiveSurcharge)}
              </p>
            )}
          </div>
          <button
            type="submit"
            form="checkout-form"
            disabled={
              submitting ||
              storeClosed ||
              !allCupsLabeled ||
              (!isFreeRedeem &&
                (payMethod === "card" ? !cardReady
                  : payMethod === "apple" ? !applePayAvailable
                  : !googlePayAvailable)) ||
              (fulfillment === "DELIVERY" && quoteState.kind !== "ok")
            }
            className={`flex min-w-[148px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${
              storeClosed
                ? ""
                : payMethod === "apple"
                  ? "bg-black"
                  : payMethod === "google"
                    ? "bg-[#3c4043]"
                    : ""
            }`}
            style={
              storeClosed
                ? { backgroundColor: "#a1a1aa" }
                : payMethod !== "apple" && payMethod !== "google"
                  ? { backgroundColor: BRAND.primaryColor }
                  : undefined
            }
          >
            {storeClosed
              ? `Closed · ${orderingStatus?.nextLabel ?? ""}`
              : submitting
                ? "Processing…"
                : !allCupsLabeled
                  ? (cupLabelGate === "ai-pending"
                      ? "Waiting for AI image…"
                      : cupLabelGate === "draw-pending"
                        ? "Saving your drawing…"
                        : "Preparing labels…")
                  : isFreeRedeem
                    ? "Redeem Free Drink"
                    : payMethod === "apple"
                      ? <><span>Pay with</span> <AppleLogo className="ml-0.5 -mt-0.5" /><span className="font-semibold">Pay</span></>
                      : payMethod === "google"
                        ? <><span>Pay with</span> <GoogleGLogo /> <span className="font-semibold">Pay</span></>
                        : cardReady
                          ? <><CardIcon /> Place Order</>
                          : "Loading…"}
          </button>
        </div>
      </div>
    </CheckoutFrame>
  );
}

function CheckoutFrame({ children }: { children: React.ReactNode }) {
  return (
    // overflow-x-clip guards against any stray horizontal overflow (e.g. an
    // SDK-injected wallet button) scrolling the page sideways on mobile — it
    // clips the x-axis without establishing a scroll container, so vertical
    // scroll and the sticky/fixed bars are unaffected.
    <div className="flex flex-1 flex-col overflow-x-clip">
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-10 pt-4 sm:px-6 lg:pt-10">
        {/* Desktop keeps the focused stacked header; mobile uses the sticky
            MobileAppBar (back + "Checkout" + cart) from the global chrome. */}
        <div className="hidden lg:block">
          <Link
            href="/menu"
            className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink2 transition hover:text-ink"
          >
            <BackArrow /> Back to menu
          </Link>
          <h1 className="mb-8 font-serif text-[clamp(32px,5vw,44px)] font-semibold leading-[1.05] tracking-[-0.035em] text-ink">
            Checkout
          </h1>
        </div>
        {children}
      </main>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[12px] font-bold uppercase tracking-[0.1em] text-ink3">
      {children}
    </h3>
  );
}

function BackArrow() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
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
      {line.itemImageUrl ? (
        <Image
          src={line.itemImageUrl}
          alt={line.itemName}
          width={56}
          height={56}
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
          <p className="text-sm font-bold text-ink">
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
          <p className="mt-0.5 text-xs text-ink3">{details}</p>
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
