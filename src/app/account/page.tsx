"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { AuthSplitCard } from "@/components/auth/AuthSplitCard";
import { useAuth } from "@/components/auth/AuthProvider";
import { tierFor } from "@/lib/membership-tier";
import { prettyPhone } from "@/lib/auth-format";
import { AccountView } from "@/components/account/AccountView";
import type { OrderHistoryItem } from "@/components/account/OrderRow";

export default function AccountPage() {
  const { profile, loyalty, starsPerReward, signOut, refresh, loading } =
    useAuth();
  const router = useRouter();

  const [orders, setOrders] = useState<OrderHistoryItem[]>([]);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const userId = profile?.user_id;

  useEffect(() => {
    if (!userId) {
      setOrders([]);
      setOrdersError(null);
      return;
    }
    let cancelled = false;
    // Clear any stale error from a previous fetch — a single transient
    // 401 used to leave the "Sign in to see your order history" pill
    // pinned above AccountHeader forever, even after the next fetch
    // succeeded.
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
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const { activeOrders, pastOrders } = useMemo(() => {
    const active = orders.filter((o) => o.state === "OPEN");
    const past = orders.filter((o) => o.state !== "OPEN");
    return { activeOrders: active, pastOrders: past };
  }, [orders]);

  const balance = loyalty?.balance ?? 0;
  const lifetime = loyalty?.lifetimePoints ?? balance;
  const goal = starsPerReward > 0 ? starsPerReward : 9;
  const rewardsAvailable = Math.floor(balance / goal);
  const currentStars = balance % goal;
  const tier = tierFor(lifetime);
  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    "Member";

  const [freeToppingsRemaining, setFreeToppingsRemaining] = useState<
    number | null
  >(null);
  useEffect(() => {
    if (!userId || tier !== "diamond") {
      setFreeToppingsRemaining(null);
      return;
    }
    const controller = new AbortController();
    fetch("/api/tier/toppings", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        const json = await res.json();
        if (res.ok && json.ok && typeof json.remaining === "number") {
          setFreeToppingsRemaining(json.remaining);
        }
      })
      .catch(() => {
        // best-effort decoration — card simply omits the toppings line
      });
    return () => controller.abort();
  }, [userId, tier]);

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 pb-24 pt-10">
        <LoadingSpinner />
      </main>
    );
  }
  if (!profile) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 pb-24 pt-10">
        <AuthSplitCard onComplete={refresh} />
      </main>
    );
  }

  return (
    <AccountView
      displayName={displayName}
      phone={prettyPhone(profile.phone_e164 ?? "")}
      phoneE164={profile.phone_e164}
      squareCustomerId={profile.square_customer_id}
      tier={tier}
      balance={balance}
      currentStars={currentStars}
      goal={goal}
      lifetime={lifetime}
      rewardsAvailable={rewardsAvailable}
      freeToppingsRemaining={freeToppingsRemaining}
      activeOrders={activeOrders}
      pastOrders={pastOrders}
      ordersError={ordersError}
      onViewOrders={() => router.push("/account/orders")}
      onViewPromotions={() => router.push("/account/promotions")}
      onSignOut={signOut}
    />
  );
}
