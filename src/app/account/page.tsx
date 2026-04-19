"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { BRAND } from "@/lib/constants";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
const MemberQrCard = dynamic(
  () => import("@/components/account/MemberQrCard").then((m) => m.MemberQrCard),
  { ssr: false },
);
import { WelcomeDiscountCard } from "@/components/account/WelcomeDiscountCard";
import { SignInCard } from "@/components/auth/SignInCard";
import { useAuth } from "@/components/auth/AuthProvider";
import { formatPrice } from "@/lib/utils";

// Account page. Auth is now owned by <AuthProvider> + Supabase: this
// page is a pure view on top of `useAuth()`, plus a side-fetch for
// the order history list (which `/api/me` intentionally omits because
// it's larger and only needed on this page).

type OrderHistoryItem = {
  id: string;
  createdAt: string | null;
  state: string | null;
  fulfillmentState: string | null;
  totalCents: string;
  itemSummary: string;
  lineCount: number;
};

// Staff move an order to "Ready" by flipping the pickup fulfillment to
// PREPARED; the order's own state stays OPEN. Promote that combo so the
// customer sees a green "Ready" badge.
function effectiveState(
  state: string | null,
  fulfillmentState: string | null,
): string {
  if (state === "OPEN" && fulfillmentState === "PREPARED") return "READY";
  return state ?? "";
}

const STATE_STYLES: Record<
  string,
  { label: string; className: string }
> = {
  OPEN: {
    label: "In Progress",
    className: "bg-orange-50 text-orange-700 border-orange-200",
  },
  READY: {
    label: "Ready",
    className: "bg-green-50 text-green-700 border-green-200",
  },
  COMPLETED: {
    label: "Completed",
    className: "bg-zinc-50 text-zinc-600 border-zinc-200",
  },
  CANCELED: {
    label: "Cancelled",
    className: "bg-red-50 text-red-700 border-red-200",
  },
};

export default function AccountPage() {
  const { profile, loyalty, welcomeDiscount, starsPerReward, loading, signOut, refresh } =
    useAuth();

  const [orders, setOrders] = useState<OrderHistoryItem[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) {
      setOrders([]);
      return;
    }
    let cancelled = false;
    setOrdersLoading(true);
    setOrdersError(null);
    fetch("/api/orders/history", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setOrdersError(json.error ?? "Failed to load orders");
          return;
        }
        setOrders(json.orders ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setOrdersError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setOrdersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.user_id]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
      {loading ? (
        <LoadingSpinner />
      ) : !profile ? (
        <SignInCard onComplete={refresh} />
      ) : (
        <AccountDashboard
          profile={profile}
          balance={loyalty?.balance ?? 0}
          lifetimePoints={loyalty?.lifetimePoints ?? 0}
          starsPerReward={starsPerReward}
          welcomeDiscount={welcomeDiscount}
          orders={orders}
          ordersLoading={ordersLoading}
          ordersError={ordersError}
          onSignOut={signOut}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */
/*  Dashboard                                                          */
/* ------------------------------------------------------------------ */

const RECENT_ORDER_LIMIT = 6;

function AccountDashboard({
  profile,
  balance,
  lifetimePoints,
  starsPerReward,
  welcomeDiscount,
  orders,
  ordersLoading,
  ordersError,
  onSignOut,
}: {
  profile: {
    square_customer_id: string;
    phone_e164: string;
    first_name: string | null;
    last_name: string | null;
  };
  balance: number;
  lifetimePoints: number;
  starsPerReward: number;
  welcomeDiscount: { available: boolean; percentage: number };
  orders: OrderHistoryItem[];
  ordersLoading: boolean;
  ordersError: string | null;
  onSignOut: () => void;
}) {
  const [showAllOrders, setShowAllOrders] = useState(false);
  const displayName =
    [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Friend";
  const filled = Math.min(balance, starsPerReward);
  const remaining = Math.max(starsPerReward - balance, 0);
  const rewardsAvailable = Math.floor(balance / starsPerReward);
  const rewardReady = balance >= starsPerReward;

  return (
    <div className="space-y-8">
      {ordersError && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {ordersError}
        </p>
      )}

      {/* ── Profile header card ── */}
      <section className="relative overflow-hidden rounded-2xl border border-black/10 bg-white p-5 shadow-sm sm:p-8">
        {/* Decorative background motif (top-right) */}
        <div
          className="pointer-events-none absolute -top-6 -right-6 h-40 w-40 rounded-full opacity-[0.07]"
          style={{ backgroundColor: BRAND.primaryColor }}
        />
        <div
          className="pointer-events-none absolute top-8 right-16 h-24 w-24 rounded-full opacity-[0.05]"
          style={{ backgroundColor: BRAND.primaryColor }}
        />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
          <div className="flex items-center gap-3 sm:gap-5">
            {/* Avatar */}
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-2xl font-bold text-white shadow-md sm:h-24 sm:w-24 sm:text-3xl"
              style={{ backgroundColor: BRAND.primaryColor }}
            >
              {(profile.first_name?.[0] ?? "?").toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
                {displayName}
              </h1>
              <p className="mt-0.5 text-sm text-zinc-500">{profile.phone_e164}</p>
              <p
                className="mt-1.5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
                style={{
                  backgroundColor: BRAND.accentColor,
                  color: BRAND.primaryColor,
                }}
              >
                <StarIcon className="h-3 w-3" />
                {lifetimePoints > 0
                  ? `${lifetimePoints} lifetime stars`
                  : "New member"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/menu"
              className="rounded-full px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: BRAND.primaryColor }}
            >
              Order
            </a>
            <a
              href="/account/promotions"
              className="relative rounded-full border border-black/15 px-5 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              Promotions
              {rewardsAvailable > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ backgroundColor: BRAND.primaryColor }}
                >
                  {rewardsAvailable}
                </span>
              )}
            </a>
            <button
              type="button"
              onClick={onSignOut}
              className="rounded-full border border-black/15 px-5 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </section>

      {/* ── Member QR card ── */}
      <MemberQrCard
        customerId={profile.square_customer_id}
        phoneE164={profile.phone_e164}
      />

      {welcomeDiscount.available && (
        <WelcomeDiscountCard />
      )}

      {/* ── Loyalty card ── */}
      <div>
        <section className="relative overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm">
          {/* Watermark star */}
          <div className="pointer-events-none absolute top-4 right-4 opacity-[0.06]">
            <svg
              width="120"
              height="120"
              viewBox="0 0 24 24"
              fill="currentColor"
              style={{ color: BRAND.primaryColor }}
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </div>

          <div className="p-4 sm:p-8">
            <div className="flex items-center gap-2">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full"
                style={{
                  backgroundColor: BRAND.primaryColor,
                  color: "white",
                }}
              >
                <StarIcon className="h-3.5 w-3.5" />
              </span>
              <h2
                className="text-xs font-bold uppercase tracking-widest"
                style={{ color: BRAND.primaryColor }}
              >
                Loyalty Rewards
              </h2>
            </div>

            <h3 className="mt-3 text-xl font-bold tracking-tight text-zinc-900 sm:mt-4 sm:text-3xl">
              Collect {starsPerReward} stars for a free drink!
            </h3>
            <p className="mt-2 text-sm text-zinc-600">
              {rewardReady
                ? `You have ${rewardsAvailable} reward${rewardsAvailable > 1 ? "s" : ""} ready to redeem!`
                : `You have ${balance} star${balance !== 1 ? "s" : ""}. Just ${remaining} more to go for your next artisanal boba.`}
            </p>
          </div>

          {/* Stamp row */}
          <div className="border-t border-black/5 px-4 py-5 sm:px-8 sm:py-6">
            <div className="flex flex-wrap justify-center gap-2.5 sm:justify-start sm:gap-4">
              {Array.from({ length: starsPerReward }).map((_, i) => (
                <StampCircle key={i} filled={i < filled} />
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* ── Order history ── */}
      <OrderHistorySections
        orders={orders}
        showAllPast={showAllOrders}
        onToggleShowAll={() => setShowAllOrders((prev) => !prev)}
        refreshing={ordersLoading}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Order history sections (In Progress / Past Orders)                 */
/* ------------------------------------------------------------------ */

function OrderHistorySections({
  orders,
  showAllPast,
  onToggleShowAll,
  refreshing,
}: {
  orders: OrderHistoryItem[];
  showAllPast: boolean;
  onToggleShowAll: () => void;
  refreshing: boolean;
}) {
  const inProgress = orders.filter((o) => o.state === "OPEN");
  const past = orders.filter((o) => o.state !== "OPEN");

  if (refreshing && orders.length === 0) {
    return (
      <section>
        <h2 className="mb-5 text-2xl font-bold tracking-tight text-zinc-900">
          Orders
        </h2>
        <p className="text-sm text-zinc-500">Loading orders…</p>
      </section>
    );
  }

  if (orders.length === 0) {
    return (
      <section>
        <h2 className="mb-5 text-2xl font-bold tracking-tight text-zinc-900">
          Orders
        </h2>
        <div className="rounded-2xl border border-dashed border-black/15 p-10 text-center text-sm text-zinc-500">
          No orders yet.{" "}
          <Link
            href="/menu"
            className="font-medium underline"
            style={{ color: BRAND.primaryColor }}
          >
            Browse the menu
          </Link>
        </div>
      </section>
    );
  }

  const visiblePast = showAllPast ? past : past.slice(0, RECENT_ORDER_LIMIT);

  return (
    <div className="space-y-8">
      {inProgress.length > 0 && (
        <section>
          <h2 className="mb-5 text-2xl font-bold tracking-tight text-zinc-900">
            In Progress
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {inProgress.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
              Past Orders
            </h2>
            {past.length > RECENT_ORDER_LIMIT && (
              <button
                type="button"
                onClick={onToggleShowAll}
                className="text-sm font-semibold transition hover:opacity-80"
                style={{ color: BRAND.primaryColor }}
              >
                {showAllPast ? "Show Recent" : "View All Orders"}
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {visiblePast.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Order card                                                         */
/* ------------------------------------------------------------------ */

function OrderCard({ order }: { order: OrderHistoryItem }) {
  const stateKey = effectiveState(order.state, order.fulfillmentState);
  const stateInfo = STATE_STYLES[stateKey];

  return (
    <Link
      href={`/order-confirmation/${order.id}`}
      className="flex flex-col justify-between rounded-2xl border border-black/10 bg-white p-5 shadow-sm transition hover:shadow-md"
    >
      <div>
        {/* Date + status */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            {formatDate(order.createdAt)}
          </p>
          {stateInfo && (
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${stateInfo.className}`}
            >
              {stateInfo.label}
            </span>
          )}
        </div>

        {/* Item name */}
        <h3 className="mt-2 text-base font-bold text-zinc-900">
          {order.itemSummary || `${order.lineCount} item(s)`}
        </h3>

        <div className="mt-2 space-y-1">
          <p className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span
              className="inline-block h-1 w-1 rounded-full"
              style={{ backgroundColor: BRAND.primaryColor }}
            />
            {order.lineCount} item{order.lineCount !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Price */}
      <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-4">
        <p className="text-lg font-bold text-zinc-900">
          {formatPrice(BigInt(order.totalCents))}
        </p>
        <span
          className="rounded-full px-5 py-2 text-xs font-semibold text-white transition hover:opacity-90"
          style={{ backgroundColor: BRAND.primaryColor }}
        >
          View Order
        </span>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  Stamp circle                                                       */
/* ------------------------------------------------------------------ */

function StampCircle({ filled }: { filled: boolean }) {
  if (filled) {
    return (
      <div
        className="flex h-11 w-11 items-center justify-center rounded-full shadow-sm sm:h-16 sm:w-16"
        style={{ backgroundColor: BRAND.primaryColor }}
        aria-label="Earned stamp"
      >
        <StarIcon className="h-4 w-4 text-white sm:h-6 sm:w-6" />
      </div>
    );
  }
  return (
    <div
      className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed sm:h-16 sm:w-16"
      style={{
        borderColor: BRAND.primaryColor,
      }}
      aria-label="Empty stamp"
    >
      <StarIcon
        className="h-4 w-4 opacity-30 sm:h-6 sm:w-6"
        style={{ color: BRAND.primaryColor }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-AU", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

function StarIcon({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}
