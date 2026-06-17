"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { SignInCard } from "@/components/auth/SignInCard";
import { useAuth } from "@/components/auth/AuthProvider";
import { OrdersView } from "@/components/account/OrdersView";
import { OrdersSkeleton } from "@/components/account/OrdersSkeleton";
import type { OrderHistoryItem } from "@/components/account/OrderRow";

function OrdersContent() {
  const { profile, loading, refresh } = useAuth();
  const userId = profile?.user_id;
  // Orders is a top-level tab destination, so the "← Account" back link only
  // makes sense when the user drilled in from the Account page (which passes
  // ?from=account). Reached via the bottom tab bar (plain /account/orders) it's
  // omitted — the tab bar already provides navigation back to Account.
  const fromAccount = useSearchParams().get("from") === "account";
  const [orders, setOrders] = useState<OrderHistoryItem[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // No session yet — the page renders SignInCard in this case, so we leave
    // the orders state untouched (avoids a synchronous setState in the effect).
    if (!userId) return;
    let cancelled = false;
    // ordersLoading starts true; the fetch's .finally flips it off. (Setting it
    // true synchronously here would trip react-hooks/set-state-in-effect, and
    // userId is effectively stable for the page's lifetime.)
    fetch("/api/orders/history", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setError(json.error ?? "Failed to load orders");
          return;
        }
        setOrders(json.orders ?? []);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setOrdersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 pt-10 pb-24">
      {loading ? (
        <LoadingSpinner />
      ) : !profile ? (
        <div className="px-4 pt-10">
          <SignInCard onComplete={refresh} />
        </div>
      ) : (
        <>
          {fromAccount && (
            <div className="px-4 pt-2 pb-3">
              <Link
                href="/account"
                className="inline-flex items-center gap-1 text-ink2 transition active:opacity-70"
                style={{ fontSize: 13 }}
              >
                <ArrowLeft size={14} />
                Account
              </Link>
            </div>
          )}
          {error && (
            <p
              className="mx-4 mt-1 rounded-tile border border-red-200 bg-red-50 p-3 text-red-700"
              style={{ fontSize: 13 }}
            >
              {error}
            </p>
          )}
          {ordersLoading ? <OrdersSkeleton /> : <OrdersView orders={orders} />}
        </>
      )}
    </main>
  );
}

export default function AccountOrdersPage() {
  // useSearchParams() requires a Suspense boundary.
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-4xl flex-1 pt-10 pb-24">
          <OrdersSkeleton />
        </main>
      }
    >
      <OrdersContent />
    </Suspense>
  );
}
