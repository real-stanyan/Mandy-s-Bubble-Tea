"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BRAND, LOYALTY } from "@/lib/constants";
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AccountData | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const loadAccount = useCallback(async (phone: string) => {
    setLoading(true);
    setError(null);
    try {
      // 1) Resolve phone → customerId (lookup only, no create).
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
        throw new Error(
          "We couldn't find an account for that phone. Place an order first to sign up.",
        );
      }

      const { customerId, givenName, familyName, phoneE164 } = lookupJson;

      // 2+3) Loyalty balance and order history in parallel.
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
          starsPerReward:
            loyaltyJson.starsPerReward ?? LOYALTY.starsPerReward,
        },
        orders: ordersJson.orders ?? [],
      });

      window.localStorage.setItem(STORAGE_KEY, phoneE164);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Restore stored phone after hydration.
  useEffect(() => {
    setHydrated(true);
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setPhoneInput(stored);
      void loadAccount(stored);
    }
  }, [loadAccount]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phoneInput.trim()) return;
    void loadAccount(phoneInput.trim());
  }

  function handleSignOut() {
    window.localStorage.removeItem(STORAGE_KEY);
    setData(null);
    setPhoneInput("");
    setError(null);
  }

  return (
    <div className="flex flex-1 flex-col">
      <header
        className="w-full px-6 py-8 text-white"
        style={{ backgroundColor: BRAND.primaryColor }}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <Link href="/menu" className="text-sm opacity-80 hover:opacity-100">
            ← Menu
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">My account</h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        {!hydrated ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : !data ? (
          <SignInForm
            phone={phoneInput}
            onPhoneChange={setPhoneInput}
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
    </div>
  );
}

function SignInForm({
  phone,
  onPhoneChange,
  onSubmit,
  loading,
  error,
}: {
  phone: string;
  onPhoneChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-6">
      <h2 className="mb-2 text-lg font-semibold text-zinc-900">
        Find your account
      </h2>
      <p className="mb-4 text-sm text-zinc-600">
        Enter the phone number you used at checkout to see your stars and
        order history.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-700">
            Phone
          </span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder="0404 123 456"
            autoComplete="tel"
            required
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-black/40"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: BRAND.primaryColor }}
        >
          {loading ? "Looking up…" : "View my account"}
        </button>
      </form>
      {error && (
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

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
  const displayName =
    [data.givenName, data.familyName].filter(Boolean).join(" ") || "friend";
  const { balance, starsPerReward, lifetimePoints } = data.loyalty;
  const progress = Math.min(balance, starsPerReward);
  const percent = Math.round((progress / starsPerReward) * 100);
  const rewardsAvailable = Math.floor(balance / starsPerReward);

  return (
    <div className="space-y-8">
      <section className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">Signed in as</p>
          <p className="text-lg font-semibold text-zinc-900">{displayName}</p>
          <p className="text-xs text-zinc-500">{data.phoneE164}</p>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="rounded-full border border-black/15 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Sign out
        </button>
      </section>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Loyalty progress */}
      <section className="rounded-lg border border-black/10 bg-white p-6">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">
            Loyalty stars
          </h2>
          <span className="text-xs text-zinc-500">
            Lifetime: {lifetimePoints} {LOYALTY.unit}
          </span>
        </div>

        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-3xl font-semibold text-zinc-900">
            {balance} <span className="text-base font-normal">of {starsPerReward}</span>
          </span>
          <span className="text-sm text-zinc-600">
            {balance >= starsPerReward
              ? `🎉 ${rewardsAvailable} reward${rewardsAvailable > 1 ? "s" : ""} ready`
              : `${starsPerReward - balance} to go`}
          </span>
        </div>

        <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${percent}%`,
              backgroundColor: BRAND.primaryColor,
            }}
          />
        </div>

        <p className="mt-3 text-xs text-zinc-500">
          Earn 1 {LOYALTY.unit} per drink. {starsPerReward} {LOYALTY.unit} ={" "}
          {LOYALTY.rewardLabel}.
        </p>
      </section>

      {/* Order history */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-zinc-900">
          Order history
        </h2>
        {refreshing && data.orders.length === 0 ? (
          <p className="text-sm text-zinc-500">Loading orders…</p>
        ) : data.orders.length === 0 ? (
          <div className="rounded-lg border border-dashed border-black/20 p-8 text-center text-sm text-zinc-500">
            No orders yet.{" "}
            <Link
              href="/menu"
              className="underline"
              style={{ color: BRAND.primaryColor }}
            >
              Browse the menu
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-black/10 rounded-lg border border-black/10 bg-white">
            {data.orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/order-confirmation/${order.id}`}
                  className="flex items-start justify-between gap-3 p-4 hover:bg-zinc-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-900">
                      {order.itemSummary || `${order.lineCount} item(s)`}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {formatDate(order.createdAt)}
                      {order.state && order.state !== "COMPLETED"
                        ? ` · ${order.state.toLowerCase()}`
                        : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-zinc-900">
                    {formatPrice(BigInt(order.totalCents))}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-AU", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Australia/Brisbane",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
