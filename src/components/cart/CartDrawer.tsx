"use client";

import { memo, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  useCart,
  lineTotal,
  lineUnitPrice,
  cartSubtotal,
  cardSurcharge,
  platformFee,
  publicHolidaySurcharge,
  type CartLine,
  type CupLabelSelection,
} from "@/store/cart";
import { isPublicHolidayActive } from "@/lib/holiday";
import type { OrderingStatus } from "@/lib/store-status";
import { formatPrice } from "@/lib/utils";
import { pickPromoCups } from "@/lib/promo-cup-pick";
import { BRAND, CARD_SURCHARGE, LOYALTY, PH_SURCHARGE, PLATFORM_FEE } from "@/lib/constants";
import { LabelPicker } from "@/components/checkout/LabelPicker";
import { useAuth } from "@/components/auth/AuthProvider";
import { CartCupLabels } from "@/components/cart/CartCupLabels";

// Right-side slide-out drawer. Mounted once in the root layout so it's
// available from every page. Backdrop click and ESC close the drawer.
//
// Payment deliberately does NOT happen here — the drawer's only CTA routes
// to /checkout so there is exactly one payment path to maintain (the
// in-drawer wallet quick-pay used to be a second path and kept drifting
// out of sync with /checkout, e.g. the OL829 tarot-fallback bug).

export function CartDrawer() {
  const isOpen = useCart((s) => s.isOpen);
  const hydrated = useCart((s) => s.hydrated);
  const lines = useCart((s) => s.lines);
  const closeDrawer = useCart((s) => s.closeDrawer);
  const setQuantity = useCart((s) => s.setQuantity);
  const removeLine = useCart((s) => s.removeLine);
  const labelSelections = useCart((s) => s.labelSelections);
  const setLabel = useCart((s) => s.setLabel);
  const clearLabel = useCart((s) => s.clearLabel);
  const cartSessionId = useCart((s) => s.cartSessionId);

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
          closeDrawer={closeDrawer}
          setQuantity={setQuantity}
          removeLine={removeLine}
          labelSelections={labelSelections}
          setLabel={setLabel}
          clearLabel={clearLabel}
          cartSessionId={cartSessionId}
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
  closeDrawer,
  setQuantity,
  removeLine,
  labelSelections,
  setLabel,
  clearLabel,
  cartSessionId,
}: {
  lines: CartLine[];
  closeDrawer: () => void;
  setQuantity: (id: string, q: number) => void;
  removeLine: (id: string) => void;
  labelSelections: Record<string, CupLabelSelection>;
  setLabel: (cupKey: string, selection: CupLabelSelection) => void;
  clearLabel: (cupKey: string) => void;
  cartSessionId: string;
}) {
  const {
    profile,
    loading: authLoading,
    loyalty,
    welcomeDiscount,
    igFollowDiscount,
    starsPerReward: authStarsPerReward,
  } = useAuth();

  // Per-cup label picker — single modal instance covers all lines, the
  // pickerCupKey state tracks which cup is currently being edited. Cup
  // labels are optional: a cup left untouched carries no selection and the
  // server prints a random surprise tarot card for it (no pre-fill here).
  const [pickerCupKey, setPickerCupKey] = useState<string | null>(null);
  const pickerCurrent: CupLabelSelection | undefined = pickerCupKey
    ? labelSelections[pickerCupKey]
    : undefined;

  const starsPerReward = authStarsPerReward || LOYALTY.starsPerReward;
  const stars = loyalty?.balance ?? 0;
  const canRedeem = stars >= starsPerReward && starsPerReward > 0;

  const subtotal = useMemo(() => cartSubtotal(lines), [lines]);
  const surchargeAmount = useMemo(() => cardSurcharge(subtotal), [subtotal]);
  const platformFeeAmount = useMemo(() => platformFee(subtotal), [subtotal]);
  // PH surcharge — checked client-side only for display; server is authoritative.
  // Re-check every 60s so a user sitting in the drawer across the Christmas
  // Eve 18:00 cutoff (or any midnight boundary) sees the correct total before
  // submitting. 60s matches the RN app banner cadence.
  const [phActive, setPhActive] = useState(() => isPublicHolidayActive());
  useEffect(() => {
    const id = setInterval(() => setPhActive(isPublicHolidayActive()), 60_000);
    return () => clearInterval(id);
  }, []);
  const phSurchargeAmount = useMemo(
    () => (phActive ? publicHolidaySurcharge(subtotal) : 0n),
    [phActive, subtotal],
  );

  const promoCoverage = useMemo(() => {
    if (lines.length === 0) {
      return {
        welcomeCount: 0,
        welcomeDiscountCents: 0n,
        igFollowCount: 0,
        igFollowDiscountCents: 0n,
      };
    }
    const unitPrices: bigint[] = [];
    for (const line of lines) {
      const unit = lineUnitPrice(line);
      for (let i = 0; i < line.quantity; i++) unitPrices.push(unit);
    }
    const welcomeK = welcomeDiscount.available
      ? welcomeDiscount.drinksRemaining
      : 0;
    const igK = igFollowDiscount.available
      ? igFollowDiscount.drinksRemaining
      : 0;
    const { welcomeCups, igFollowCups } = pickPromoCups({
      unitPrices,
      welcomeK,
      igFollowK: igK,
      loyaltyRewardCount: 0,
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
  }, [lines, welcomeDiscount, igFollowDiscount]);
  const welcomeDiscountAmount = promoCoverage.welcomeDiscountCents;
  const igFollowDiscountAmount = promoCoverage.igFollowDiscountCents;

  return (
    <>
      <div className="flex-1 overflow-y-auto px-5">
        {lines.length === 0 ? (
          <EmptyState onClose={closeDrawer} />
        ) : (
          <>
            <TeaJourneyCard
              stars={stars}
              starsPerReward={starsPerReward}
              canRedeem={canRedeem}
            />

            <div className="mt-5 space-y-5">
              {lines.map((line) => (
                <CartLineRow
                  key={line.id}
                  line={line}
                  onQuantityChange={(q) => setQuantity(line.id, q)}
                  onRemove={() => removeLine(line.id)}
                  onPickerOpen={setPickerCupKey}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {lines.length > 0 && (
        <CartFooter
          lines={lines}
          welcomeDiscount={welcomeDiscount}
          welcomeDiscountAmount={welcomeDiscountAmount}
          welcomeCoveredCount={promoCoverage.welcomeCount}
          igFollowDiscount={igFollowDiscount}
          igFollowDiscountAmount={igFollowDiscountAmount}
          igFollowCoveredCount={promoCoverage.igFollowCount}
          surchargeAmount={surchargeAmount}
          platformFeeAmount={platformFeeAmount}
          phSurchargeAmount={phSurchargeAmount}
          hasProfile={!!profile}
          authLoading={authLoading}
        />
      )}

      {/* Single LabelPicker instance shared across every line — slotKey
          switches as the user taps a different cup. */}
      <LabelPicker
        open={pickerCupKey !== null}
        onOpenChange={(open) => {
          if (!open) setPickerCupKey(null);
        }}
        slotKey={pickerCupKey ?? ""}
        cartSessionId={cartSessionId}
        isSignedIn={!!profile}
        current={pickerCurrent}
        onSelect={(selection) => {
          if (pickerCupKey) setLabel(pickerCupKey, selection);
        }}
        onClear={() => {
          if (pickerCupKey) clearLabel(pickerCupKey);
        }}
      />
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
}: {
  stars: number;
  starsPerReward: number;
  canRedeem: boolean;
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
  onPickerOpen,
}: {
  line: CartLine;
  onQuantityChange: (q: number) => void;
  onRemove: () => void;
  onPickerOpen: (cupKey: string) => void;
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

        {/* Per-cup label picker entry — auto-fills random preset on first
            drawer open, tap any cup to swap design / draw / AI / photo. */}
        <CartCupLabels line={line} onPickerOpen={onPickerOpen} />
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
  welcomeDiscount,
  welcomeDiscountAmount,
  welcomeCoveredCount,
  igFollowDiscount,
  igFollowDiscountAmount,
  igFollowCoveredCount,
  surchargeAmount,
  platformFeeAmount,
  phSurchargeAmount,
  hasProfile,
  authLoading,
}: {
  lines: CartLine[];
  welcomeDiscount: {
    available: boolean;
    percentage: number;
    drinksRemaining: number;
  };
  welcomeDiscountAmount: bigint;
  welcomeCoveredCount: number;
  igFollowDiscount: {
    available: boolean;
    percentage: number;
    drinksRemaining: number;
  };
  igFollowDiscountAmount: bigint;
  igFollowCoveredCount: number;
  surchargeAmount: bigint;
  platformFeeAmount: bigint;
  phSurchargeAmount: bigint;
  hasProfile: boolean;
  authLoading: boolean;
}) {
  const subtotal = cartSubtotal(lines);
  const closeDrawer = useCart((s) => s.closeDrawer);

  // Ordering window — poll /api/store-status every 30s so the button flips
  // at the 22:15 cutoff (or pos_backup_mode toggle) while the drawer is
  // open. Server gate at /api/orders is authoritative; this is display-only.
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
  // Pre-fetch: treat as open to avoid flashing a "closed" state on first
  // paint. The server gate is still authoritative.
  const storeClosed = orderingKnown && !orderingOpen;

  // Display-only promo math — matches /checkout. Square still applies the
  // discounts at charge time; the server-trusted totalMoney is authoritative.
  // (Loyalty reward redemption lives on /checkout, not in the drawer.)
  const promoDiscountTotal = welcomeDiscountAmount + igFollowDiscountAmount;
  const discountedTotal =
    promoDiscountTotal > 0n
      ? subtotal - promoDiscountTotal > 0n
        ? subtotal - promoDiscountTotal
        : 0n
      : subtotal;
  const displayTotal =
    discountedTotal + surchargeAmount + platformFeeAmount + phSurchargeAmount;

  return (
    <footer className="border-t border-black/10 px-5 pb-6 pt-5">
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-zinc-600">
          <span>Subtotal</span>
          <span className="font-semibold text-zinc-900">
            {formatPrice(subtotal)}
          </span>
        </div>
        {welcomeDiscount.available &&
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
        {igFollowDiscount.available &&
          igFollowCoveredCount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: BRAND.primaryColor }}
                />
                IG Follow {igFollowDiscount.percentage || 10}% Off
                <span className="text-xs text-zinc-500">
                  ({igFollowCoveredCount} drink
                  {igFollowCoveredCount === 1 ? "" : "s"})
                </span>
              </span>
              <span style={{ color: BRAND.primaryColor }}>
                −{formatPrice(igFollowDiscountAmount)}
              </span>
            </div>
          )}
        {phSurchargeAmount > 0n && (
          <div className="flex justify-between text-sm text-zinc-600">
            <span>
              {PH_SURCHARGE.name}{" "}
              <span className="text-xs text-zinc-400">({PH_SURCHARGE.percentage}%)</span>
            </span>
            <span className="font-semibold text-zinc-900">
              {formatPrice(phSurchargeAmount)}
            </span>
          </div>
        )}
        {platformFeeAmount > 0n && (
          <div className="flex justify-between text-sm text-zinc-600">
            <span>
              {PLATFORM_FEE.name}{" "}
              <span className="text-xs text-zinc-400">({PLATFORM_FEE.percentage}%)</span>
            </span>
            <span className="font-semibold text-zinc-900">
              {formatPrice(platformFeeAmount)}
            </span>
          </div>
        )}
        {surchargeAmount > 0n && (
          <div className="flex justify-between text-sm text-zinc-600">
            <span>
              {CARD_SURCHARGE.name}{" "}
              <span className="text-xs text-zinc-400">
                ({CARD_SURCHARGE.percentage}%)
              </span>
            </span>
            <span className="font-semibold text-zinc-900">
              {formatPrice(surchargeAmount)}
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

      {storeClosed ? (
        <button
          type="button"
          disabled
          className="mt-5 w-full cursor-not-allowed rounded-xl bg-zinc-200 py-3.5 text-base font-semibold text-zinc-500"
        >
          Orders closed · {orderingStatus?.nextLabel ?? ""}
        </button>
      ) : authLoading ? (
        // Skeleton so the unauth CTA doesn't flash in front of an
        // already-signed-in user before /api/me resolves.
        <div
          className="mt-5 h-[52px] w-full animate-pulse rounded-xl bg-zinc-100"
          aria-hidden="true"
        />
      ) : !hasProfile ? (
        // Not signed in — CTA routes to /checkout where SignInCard
        // guides the user.
        <Link
          href="/checkout"
          onClick={closeDrawer}
          className="mt-5 block w-full rounded-xl py-3.5 text-center text-base font-semibold text-white transition hover:opacity-90"
          style={{ backgroundColor: BRAND.primaryColor }}
        >
          Sign in to checkout
        </Link>
      ) : (
        <>
          {/* Single payment path — everything pays on /checkout (wallet
              buttons included), so totals/labels/promos can't drift between
              two implementations. */}
          <Link
            href="/checkout"
            onClick={closeDrawer}
            className="mt-5 block w-full rounded-xl py-3.5 text-center text-base font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: BRAND.primaryColor }}
          >
            Checkout
          </Link>
          <p className="mt-2 text-center text-xs text-zinc-500">
            Pickup or delivery? Choose at checkout →
          </p>
        </>
      )}

      {/* Secondary action in every footer state (open / closed / guest) —
          closes the drawer and heads back to the menu to add more drinks. */}
      <Link
        href="/menu"
        onClick={closeDrawer}
        className="mt-3 block w-full rounded-xl border-2 py-3 text-center text-sm font-semibold transition hover:opacity-80"
        style={{ borderColor: BRAND.primaryColor, color: BRAND.primaryColor }}
      >
        Continue shopping
      </Link>
    </footer>
  );
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

