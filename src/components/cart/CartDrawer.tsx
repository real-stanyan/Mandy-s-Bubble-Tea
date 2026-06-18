"use client";

import { memo, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
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
        className={`absolute inset-0 bg-ink/45 transition-opacity ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
        onClick={closeDrawer}
      />

      {/* Panel — bottom sheet on mobile, right-side drawer on desktop */}
      <aside
        role="dialog"
        aria-label="Shopping cart"
        className={`absolute inset-x-0 bottom-0 flex max-h-[90%] flex-col rounded-t-[26px] bg-card shadow-[0_-16px_40px_rgba(42,30,20,0.25)] transition-transform sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-full sm:max-w-md sm:rounded-none sm:shadow-[-8px_0_40px_rgba(42,30,20,0.18)] ${
          isOpen
            ? "translate-y-0 sm:translate-x-0"
            : "translate-y-full sm:translate-y-0 sm:translate-x-full"
        }`}
      >
        {/* Drag handle (mobile sheet only) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden" aria-hidden="true">
          <span className="h-[5px] w-10 rounded-full bg-ink4" />
        </div>

        {/* Header */}
        <header className="flex items-start justify-between px-5 pb-4 pt-3 sm:pt-6">
          <div>
            <h2 className="font-serif text-[22px] font-semibold tracking-[-0.3px] text-ink">
              Your cart
            </h2>
            <p className="mt-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-ink4">
              {itemCount} item{itemCount !== 1 ? "s" : ""} selected
            </p>
          </div>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Close cart"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-paper text-sm text-ink2 transition hover:bg-bg2"
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
  // server prints a random lucky cat for it (no pre-fill here).
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
    <div className="rounded-card bg-cream p-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-serif text-[15px] font-semibold text-ink">
            Your Tea Journey
          </h3>
          <p className="mt-0.5 text-xs text-ink2">
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
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white">
        <div
          className="h-full rounded-full bg-brand transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <div className="mt-1.5 text-[10px] font-semibold text-ink3">
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
      <p className="text-base text-ink2">Your cart is empty.</p>
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
          className="h-16 w-16 shrink-0 rounded-tile object-cover"
        />
      ) : (
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-tile bg-cream text-lg">
          🧋
        </div>
      )}

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold text-ink">{line.itemName}</p>
          <p
            className="shrink-0 text-sm font-bold"
            style={{ color: BRAND.primaryColor }}
          >
            {formatPrice(total)}
          </p>
        </div>
        {details && (
          <p className="mt-0.5 text-xs text-ink3">{details}</p>
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
    <div className="flex items-center gap-0.5 rounded-full border border-line">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        aria-label="Decrease quantity"
        className="flex h-7 w-7 items-center justify-center rounded-l-full text-sm text-ink2 hover:bg-bg2"
      >
        −
      </button>
      <span className="w-6 text-center text-sm font-medium">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        aria-label="Increase quantity"
        className="flex h-7 w-7 items-center justify-center rounded-r-full text-sm text-ink2 hover:bg-bg2"
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

  // Fees + tax collapse into a tappable disclosure so the footer can't grow
  // tall enough to bury the cart items above it (a single drink was almost
  // entirely scrolled off on short viewports). Subtotal, any discounts, and
  // the Total stay visible; the small add-on fees hide by default.
  const [showBreakdown, setShowBreakdown] = useState(false);
  const feesTotal = phSurchargeAmount + platformFeeAmount + surchargeAmount;

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
    <footer className="border-t border-line px-5 pb-6 pt-5">
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-ink2">
          <span>Subtotal</span>
          <span className="font-semibold text-ink">
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
                <span className="text-xs text-ink3">
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
                <span className="text-xs text-ink3">
                  ({igFollowCoveredCount} drink
                  {igFollowCoveredCount === 1 ? "" : "s"})
                </span>
              </span>
              <span style={{ color: BRAND.primaryColor }}>
                −{formatPrice(igFollowDiscountAmount)}
              </span>
            </div>
          )}
        {/* Fees & tax — collapsed by default so they can't push the cart
            items off-screen. Tap to reveal the per-line breakdown. */}
        <button
          type="button"
          onClick={() => setShowBreakdown((v) => !v)}
          aria-expanded={showBreakdown}
          className="flex w-full items-center justify-between text-sm text-ink2 transition hover:text-ink"
        >
          <span className="flex items-center gap-1">
            Fees &amp; tax
            <ChevronDown
              size={14}
              className={`text-ink4 transition-transform ${
                showBreakdown ? "rotate-180" : ""
              }`}
            />
          </span>
          {!showBreakdown && (
            <span className="text-xs text-ink3">
              {feesTotal > 0n ? `+${formatPrice(feesTotal)} · ` : ""}tax at
              checkout
            </span>
          )}
        </button>
        {showBreakdown && (
          <div className="space-y-2 pl-0.5">
            {phSurchargeAmount > 0n && (
              <div className="flex justify-between text-sm text-ink2">
                <span>
                  {PH_SURCHARGE.name}{" "}
                  <span className="text-xs text-ink4">
                    ({PH_SURCHARGE.percentage}%)
                  </span>
                </span>
                <span className="font-semibold text-ink">
                  {formatPrice(phSurchargeAmount)}
                </span>
              </div>
            )}
            {platformFeeAmount > 0n && (
              <div className="flex justify-between text-sm text-ink2">
                <span>
                  {PLATFORM_FEE.name}{" "}
                  <span className="text-xs text-ink4">
                    ({PLATFORM_FEE.percentage}%)
                  </span>
                </span>
                <span className="font-semibold text-ink">
                  {formatPrice(platformFeeAmount)}
                </span>
              </div>
            )}
            {surchargeAmount > 0n && (
              <div className="flex justify-between text-sm text-ink2">
                <span>
                  {CARD_SURCHARGE.name}{" "}
                  <span className="text-xs text-ink4">
                    ({CARD_SURCHARGE.percentage}%)
                  </span>
                </span>
                <span className="font-semibold text-ink">
                  {formatPrice(surchargeAmount)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm text-ink2">
              <span>Tax</span>
              <span className="font-semibold text-ink">At checkout</span>
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
        <span className="text-base font-bold text-ink">Total Price</span>
        <span
          className="text-xl font-bold"
          style={{ color: BRAND.primaryColor }}
        >
          {formatPrice(displayTotal)}
        </span>
      </div>

      {/* Actions sit side-by-side to keep the footer short: secondary
          "Continue shopping" on the left, primary CTA on the right. */}
      <div className="mt-5 flex items-stretch gap-3">
        <Link
          href="/menu"
          onClick={closeDrawer}
          className="flex flex-1 items-center justify-center whitespace-nowrap rounded-full border border-line bg-card px-3 py-3.5 text-center text-sm font-semibold text-ink2 transition hover:bg-paper"
        >
          Continue shopping
        </Link>

        {storeClosed ? (
          <button
            type="button"
            disabled
            className="flex flex-1 cursor-not-allowed items-center justify-center whitespace-nowrap rounded-full bg-bg2 px-3 py-3.5 text-center text-sm font-semibold text-ink4"
          >
            Orders closed
          </button>
        ) : authLoading ? (
          // Skeleton so the unauth CTA doesn't flash in front of an
          // already-signed-in user before /api/me resolves.
          <div
            className="flex-1 animate-pulse rounded-full bg-paper"
            aria-hidden="true"
          />
        ) : !hasProfile ? (
          // Not signed in — CTA routes to /checkout where SignInCard
          // guides the user. Single payment path: everything pays on
          // /checkout (wallet buttons included) so totals/labels/promos
          // can't drift between two implementations.
          <Link
            href="/checkout"
            onClick={closeDrawer}
            className="flex flex-1 items-center justify-center whitespace-nowrap rounded-full bg-brand px-3 py-3.5 text-center text-sm font-semibold text-white shadow-[0_10px_18px_rgba(141,85,36,0.28)] transition hover:bg-brand-dark active:scale-[0.99]"
          >
            Sign in to checkout
          </Link>
        ) : (
          <Link
            href="/checkout"
            onClick={closeDrawer}
            className="flex flex-1 items-center justify-center whitespace-nowrap rounded-full bg-brand px-3 py-3.5 text-center text-sm font-semibold text-white shadow-[0_10px_18px_rgba(141,85,36,0.28)] transition hover:bg-brand-dark active:scale-[0.99]"
          >
            Checkout
          </Link>
        )}
      </div>
      {!storeClosed && !authLoading && hasProfile && (
        <p className="mt-2 text-center text-xs text-ink3">
          Pickup or delivery? Choose at checkout →
        </p>
      )}
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

