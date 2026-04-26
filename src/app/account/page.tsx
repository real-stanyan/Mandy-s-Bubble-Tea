"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { SignInCard } from "@/components/auth/SignInCard";
import { useAuth } from "@/components/auth/AuthProvider";
import { AccountHeader } from "@/components/account/AccountHeader";
import { LoyaltyCard } from "@/components/account/LoyaltyCard";
import { MiniStats } from "@/components/account/MiniStats";
import { AddToWalletButton } from "@/components/account/AddToWalletButton";
import { IgFollowPromoCard } from "@/components/account/IgFollowPromoCard";
import { WelcomeDiscountCard } from "@/components/account/WelcomeDiscountCard";
import { PromotionsCard } from "@/components/account/PromotionsCard";
import { OrderHistory } from "@/components/account/OrderHistory";
import { ActivityHistory } from "@/components/account/ActivityHistory";
import { StoreInfo } from "@/components/account/StoreInfo";
import { LegalFooter } from "@/components/account/LegalFooter";
import { SignOutBtn } from "@/components/account/SignOutBtn";
import { DeleteAccountBtn } from "@/components/account/DeleteAccountBtn";
import type { OrderHistoryItem } from "@/components/account/OrderRow";

// QR card uses `document` at module scope via qrcode.react — keep it
// client-only to avoid SSR mismatch (same pattern as before the rewrite).
const MemberQrCard = dynamic(
  () =>
    import("@/components/account/MemberQrCard").then((m) => m.MemberQrCard),
  { ssr: false },
);

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
      return;
    }
    let cancelled = false;
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

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 pt-10 pb-24">
      {loading ? (
        <LoadingSpinner />
      ) : !profile ? (
        <div className="mx-auto max-w-md px-4 pt-10">
          <SignInCard onComplete={refresh} />
        </div>
      ) : (
        <>
          {ordersError && (
            <p
              className="mx-4 mt-3 rounded-tile border border-red-200 bg-red-50 p-3 text-red-700"
              style={{ fontSize: 13 }}
            >
              {ordersError}
            </p>
          )}
          <AccountHeader profile={profile} />
          <div className="sm:grid sm:grid-cols-2 sm:gap-x-6 sm:items-start">
            <div className="flex flex-col">
              <WelcomeDiscountCard />
              <LoyaltyCard balance={balance} starsPerReward={goal} />
              <MiniStats
                drinks={lifetime}
                rewards={rewardsAvailable}
                stars={currentStars}
                onPressRewards={() => router.push("/account/promotions")}
              />
              <MemberQrCard
                customerId={profile.square_customer_id}
                phoneE164={profile.phone_e164}
              />
              <AddToWalletButton />
              <IgFollowPromoCard />
              <PromotionsCard rewardsCount={rewardsAvailable} />
            </div>
            <div className="flex flex-col">
              {orders.length === 0 ? (
                <OrderHistory orders={[]} title="Orders" />
              ) : (
                <>
                  <OrderHistory
                    orders={activeOrders}
                    title="In Progress"
                    hideIfEmpty
                  />
                  <OrderHistory
                    orders={pastOrders.slice(0, 3)}
                    title="Past Orders"
                    hideIfEmpty
                    onSeeAll={
                      pastOrders.length > 3
                        ? () => router.push("/account/orders")
                        : undefined
                    }
                  />
                </>
              )}
              <ActivityHistory />
              <StoreInfo />
            </div>
          </div>
          <div className="sm:mx-auto sm:w-full sm:max-w-md">
            <LegalFooter />
            <SignOutBtn onSignOut={signOut} />
            <DeleteAccountBtn />
          </div>
        </>
      )}
    </main>
  );
}
