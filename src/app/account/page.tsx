"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BRAND, LOYALTY } from "@/lib/constants";

const SQUARE_PROFILE_URL = LOYALTY.squareProfileUrl;
// Square's customer profile host (profile.squareup.com) is production-only —
// there is no sandbox equivalent. Hide the Apple Wallet banner until we're
// running against a production Square account with a real profile URL.
const SHOW_WALLET_BANNER =
  process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === "production";
import { formatPrice } from "@/lib/utils";

// Account page: phone-based "sign-in" (no passwords — Square is the
// source of truth, and the phone number is the stable identifier for
// a customer + their loyalty account). We persist the phone in
// localStorage so returning visitors land straight on their dashboard.

const STORAGE_KEY = "mbt:account:phone";

type LoyaltyInfo = {
  accountId: string;
  balance: number;
  lifetimePoints: number;
  starsPerReward: number;
};

type OrderHistoryItem = {
  id: string;
  createdAt: string | null;
  state: string | null;
  totalCents: string;
  itemSummary: string;
  lineCount: number;
};

type AccountData = {
  customerId: string;
  givenName: string | null;
  familyName: string | null;
  phoneE164: string;
  loyalty: LoyaltyInfo;
  orders: OrderHistoryItem[];
};

export default function AccountPage() {
  const [phoneInput, setPhoneInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [signupPhone, setSignupPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AccountData | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const hydrateDashboard = useCallback(
    async (customerId: string, phoneE164: string, givenName: string | null, familyName: string | null) => {
      const [loyaltyRes, ordersRes] = await Promise.all([
        fetch("/api/loyalty/account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId, phone: phoneE164 }),
        }),
        fetch("/api/orders/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId }),
        }),
      ]);

      const loyaltyJson = await loyaltyRes.json();
      const ordersJson = await ordersRes.json();
      if (!loyaltyRes.ok || !loyaltyJson.ok) {
        throw new Error(loyaltyJson.error ?? "Loyalty lookup failed");
      }
      if (!ordersRes.ok || !ordersJson.ok) {
        throw new Error(ordersJson.error ?? "Order history failed");
      }

      setData({
        customerId,
        givenName,
        familyName,
        phoneE164,
        loyalty: {
          accountId: loyaltyJson.accountId,
          balance: loyaltyJson.balance ?? 0,
          lifetimePoints: loyaltyJson.lifetimePoints ?? 0,
          starsPerReward: loyaltyJson.starsPerReward ?? LOYALTY.starsPerReward,
        },
        orders: ordersJson.orders ?? [],
      });

      window.localStorage.setItem(STORAGE_KEY, phoneE164);
    },
    [],
  );

  const loadAccount = useCallback(async (phone: string) => {
    setLoading(true);
    setError(null);
    try {
      const lookupRes = await fetch("/api/customer/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const lookupJson = await lookupRes.json();
      if (!lookupRes.ok || !lookupJson.ok) {
        throw new Error(lookupJson.error ?? "Lookup failed");
      }
      if (!lookupJson.found) {
        // No existing customer — switch the form into sign-up mode so the
        // user can finish by entering their name. /api/customer will then
        // create the Square customer and we load the (empty) dashboard.
        setSignupPhone(phone);
        setLoading(false);
        return;
      }

      const { customerId, givenName, familyName, phoneE164 } = lookupJson;
      await hydrateDashboard(customerId, phoneE164, givenName, familyName);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [hydrateDashboard]);

  const signUp = useCallback(
    async (name: string, phone: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/customer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, phone }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error ?? "Sign up failed");
        }

        const [givenName, ...rest] = name.trim().split(/\s+/);
        const familyName = rest.join(" ") || null;
        const phoneE164 = json.phoneE164 ?? phone;

        await hydrateDashboard(json.customerId, phoneE164, givenName, familyName);
        setSignupPhone(null);
        setNameInput("");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [hydrateDashboard],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setPhoneInput(stored);
      setLoading(true);
      void loadAccount(stored);
    }
    setHydrated(true);
  }, [loadAccount]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (signupPhone) {
      if (!nameInput.trim()) return;
      void signUp(nameInput.trim(), signupPhone);
      return;
    }
    if (!phoneInput.trim()) return;
    void loadAccount(phoneInput.trim());
  }

  function handleBackToPhone() {
    setSignupPhone(null);
    setNameInput("");
    setError(null);
  }

  function handleSignOut() {
    window.localStorage.removeItem(STORAGE_KEY);
    setData(null);
    setPhoneInput("");
    setNameInput("");
    setSignupPhone(null);
    setError(null);
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
      {!hydrated || (!data && loading) ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : !data ? (
        <SignInForm
          phone={phoneInput}
          onPhoneChange={setPhoneInput}
          name={nameInput}
          onNameChange={setNameInput}
          signupMode={signupPhone !== null}
          onBackToPhone={handleBackToPhone}
          onSubmit={handleSubmit}
          loading={loading}
          error={error}
        />
      ) : (
        <AccountDashboard
          data={data}
          onSignOut={handleSignOut}
          refreshing={loading}
          error={error}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */
/*  Sign-in form                                                       */
/* ------------------------------------------------------------------ */

function SignInForm({
  phone,
  onPhoneChange,
  name,
  onNameChange,
  signupMode,
  onBackToPhone,
  onSubmit,
  loading,
  error,
}: {
  phone: string;
  onPhoneChange: (v: string) => void;
  name: string;
  onNameChange: (v: string) => void;
  signupMode: boolean;
  onBackToPhone: () => void;
  onSubmit: (e: React.FormEvent) => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-black/10 bg-white p-5 shadow-sm sm:p-8">
      <h2 className="mb-2 text-2xl font-bold text-zinc-900">
        {signupMode ? "Finish Signing Up" : "Login or Sign Up"}
      </h2>
      <p className="mb-6 text-sm leading-relaxed text-zinc-600">
        {signupMode
          ? "Looks like you're new here. What should we call you?"
          : "Welcome back! Please enter your mobile number to continue to your tea sanctuary."}
      </p>
      <form onSubmit={onSubmit} className="space-y-5">
        {signupMode ? (
          <div>
            <span className="mb-2 block text-sm font-semibold text-zinc-800">
              Your Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="e.g. Mandy"
              autoComplete="given-name"
              autoFocus
              required
              className="w-full rounded-full border border-black/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-black/40"
            />
            <button
              type="button"
              onClick={onBackToPhone}
              className="mt-2 text-xs text-zinc-500 underline-offset-2 hover:underline"
            >
              ← Use a different phone number
            </button>
          </div>
        ) : (
          <div>
            <span className="mb-2 block text-sm font-semibold text-zinc-800">
              Mobile Number
            </span>
            <div className="flex items-center gap-2">
              <span
                className="flex shrink-0 items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium"
                style={{
                  backgroundColor: BRAND.accentColor,
                  color: BRAND.primaryColor,
                }}
              >
                +61
              </span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => onPhoneChange(e.target.value)}
                placeholder="0400 000 000"
                autoComplete="tel"
                required
                className="w-full rounded-full border border-black/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-black/40"
              />
            </div>
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: BRAND.primaryColor }}
        >
          {loading
            ? signupMode
              ? "Creating account…"
              : "Looking up…"
            : signupMode
              ? "Create Account →"
              : "View My Account →"}
        </button>
      </form>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <p className="mt-5 text-center text-xs text-zinc-400">
        By continuing, you agree to our{" "}
        <a href="#" className="font-medium" style={{ color: BRAND.primaryColor }}>
          Terms of Service
        </a>{" "}
        and{" "}
        <a href="#" className="font-medium" style={{ color: BRAND.primaryColor }}>
          Privacy Policy
        </a>
        .
      </p>

      <div className="mt-6 flex items-center gap-3 text-xs text-zinc-400">
        <div className="h-px flex-1 bg-black/10" />
        <span>Need help?</span>
        <div className="h-px flex-1 bg-black/10" />
      </div>

      <a
        href="tel:0404978238"
        className="mt-4 flex items-center justify-center gap-2 text-sm font-semibold text-zinc-700 transition hover:text-zinc-900"
      >
        <PhoneIcon />
        Contact Support
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dashboard                                                          */
/* ------------------------------------------------------------------ */

const RECENT_ORDER_LIMIT = 6;

function AccountDashboard({
  data,
  onSignOut,
  refreshing,
  error,
}: {
  data: AccountData;
  onSignOut: () => void;
  refreshing: boolean;
  error: string | null;
}) {
  const [showAllOrders, setShowAllOrders] = useState(false);
  const displayName =
    [data.givenName, data.familyName].filter(Boolean).join(" ") || "Friend";
  const { balance, starsPerReward, lifetimePoints } = data.loyalty;
  const filled = Math.min(balance, starsPerReward);
  const remaining = Math.max(starsPerReward - balance, 0);
  const rewardsAvailable = Math.floor(balance / starsPerReward);
  const rewardReady = balance >= starsPerReward;

  return (
    <div className="space-y-8">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
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
              {(data.givenName?.[0] ?? "?").toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
                {displayName}
              </h1>
              <p className="mt-0.5 text-sm text-zinc-500">{data.phoneE164}</p>
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

        {/* Apple Wallet banner — mobile only, production only */}
        {SHOW_WALLET_BANNER && (
          <a
            href={SQUARE_PROFILE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white p-4 shadow-sm transition hover:shadow-md sm:hidden"
          >
            <p className="text-sm font-medium text-zinc-700">
              Easily check in and track rewards with Apple Wallet.
            </p>
            <span className="flex shrink-0 items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white">
              <AppleWalletIcon />
              <span className="leading-tight">
                Add to<br />Apple Wallet
              </span>
            </span>
          </a>
        )}
      </div>


      {/* ── Order history ── */}
      <section>
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
            {showAllOrders ? "Order History" : "Recent Order History"}
          </h2>
          {data.orders.length > RECENT_ORDER_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAllOrders((prev) => !prev)}
              className="text-sm font-semibold transition hover:opacity-80"
              style={{ color: BRAND.primaryColor }}
            >
              {showAllOrders ? "Show Recent" : "View All Orders"}
            </button>
          )}
        </div>

        {refreshing && data.orders.length === 0 ? (
          <p className="text-sm text-zinc-500">Loading orders…</p>
        ) : data.orders.length === 0 ? (
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
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {(showAllOrders
              ? data.orders
              : data.orders.slice(0, RECENT_ORDER_LIMIT)
            ).map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Order card                                                         */
/* ------------------------------------------------------------------ */

function OrderCard({ order }: { order: OrderHistoryItem }) {
  const stateBadgeColor =
    order.state === "COMPLETED"
      ? "bg-green-50 text-green-700 border-green-200"
      : "bg-zinc-50 text-zinc-600 border-zinc-200";

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-black/10 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div>
        {/* Date + status */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            {formatDate(order.createdAt)}
          </p>
          {order.state && (
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${stateBadgeColor}`}
            >
              {order.state.charAt(0) + order.state.slice(1).toLowerCase()}
            </span>
          )}
        </div>

        {/* Item name */}
        <h3 className="mt-2 text-base font-bold text-zinc-900">
          {order.itemSummary || `${order.lineCount} item(s)`}
        </h3>

        {/* Placeholder customisation details (from data if available) */}
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

      {/* Price + Reorder */}
      <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-4">
        <p className="text-lg font-bold text-zinc-900">
          {formatPrice(BigInt(order.totalCents))}
        </p>
        <Link
          href={`/order-confirmation/${order.id}`}
          className="rounded-full px-5 py-2 text-xs font-semibold text-white transition hover:opacity-90"
          style={{ backgroundColor: BRAND.primaryColor }}
        >
          Reorder
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Quick link item                                                    */
/* ------------------------------------------------------------------ */

function QuickLinkItem({
  icon,
  label,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 py-4 text-sm font-medium text-zinc-700 transition hover:text-zinc-900"
    >
      <span className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
          {icon}
        </span>
        {label}
      </span>
      <ChevronRightIcon />
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

function SettingsIcon() {
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
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function PaymentIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
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

function HelpIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function AppleWalletIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      {/* Simplified wallet card stack icon */}
      <rect x="2" y="6" width="20" height="14" rx="2" fill="#4CAF50" />
      <rect x="3" y="4" width="18" height="14" rx="2" fill="#FF9800" />
      <rect x="4" y="2" width="16" height="14" rx="2" fill="#2196F3" />
      <rect x="6" y="5" width="5" height="5" rx="1" fill="#FFD54F" />
      <rect x="6" y="5" width="2.5" height="2.5" rx="0.5" fill="#F44336" />
      <rect x="8.5" y="5" width="2.5" height="2.5" rx="0.5" fill="#66BB6A" />
      <rect x="6" y="7.5" width="2.5" height="2.5" rx="0.5" fill="#42A5F5" />
      <rect x="8.5" y="7.5" width="2.5" height="2.5" rx="0.5" fill="#FFA726" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-zinc-400"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

