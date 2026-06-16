"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { SignInCard } from "@/components/auth/SignInCard";
import { useAuth } from "@/components/auth/AuthProvider";
import { OrdersView } from "@/components/account/OrdersView";
import type { OrderHistoryItem } from "@/components/account/OrderRow";

export default function AccountOrdersPage() {
  const { profile, loading, refresh } = useAuth();
  const userId = profile?.user_id;
  const [orders, setOrders] = useState<OrderHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setOrders([]);
      return;
    }
    let cancelled = false;
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
          {error && (
            <p
              className="mx-4 mt-1 rounded-tile border border-red-200 bg-red-50 p-3 text-red-700"
              style={{ fontSize: 13 }}
            >
              {error}
            </p>
          )}
          <OrdersView orders={orders} />
        </>
      )}
    </main>
  );
}
