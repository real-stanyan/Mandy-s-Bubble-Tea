"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { AuthSplitCard } from "@/components/auth/AuthSplitCard";
import { useAuth } from "@/components/auth/AuthProvider";
import { LoyaltyCard } from "@/components/account/LoyaltyCard";
import { TierUpCelebration } from "@/components/account/TierUpCelebration";
import { tierFor } from "@/lib/membership-tier";
import { prettyPhone } from "@/lib/auth-format";
import {
  ProfileSummaryCard,
  TierPerksChips,
  RewardStatsRow,
  HowItWorks,
  AccountSettings,
  StoreCard,
} from "@/components/account/ProfileBits";
import { AddToWalletButton } from "@/components/account/AddToWalletButton";
import { IgFollowPromoCard } from "@/components/account/IgFollowPromoCard";
import { WelcomeDiscountCard } from "@/components/account/WelcomeDiscountCard";
import { PromotionsCard } from "@/components/account/PromotionsCard";
import { OrderHistory } from "@/components/account/OrderHistory";
import { ActivityHistory } from "@/components/account/ActivityHistory";
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

// Neutralizes the legacy single-column self-margins (px-4 / mx-4 / mt-* /
// mb-*) that the reused account cards carry, so the new grid layout owns
// all spacing. Targets the card's own root (the direct child), leaving the
// shared components untouched → orders/promotions pages stay as-is.
function Flush({ children }: { children: ReactNode }) {
  return (
    <div className="[&>*]:!mx-0 [&>*]:!mt-0 [&>*]:!mb-0 [&>*]:!px-0">
      {children}
    </div>
  );
}

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

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 pt-10 pb-24">
      {loading ? (
        <LoadingSpinner />
      ) : !profile ? (
        <AuthSplitCard onComplete={refresh} />
      ) : (
        <>
          <TierUpCelebration tier={tier} />
          {ordersError && (
            <p
              className="mx-4 mt-3 rounded-tile border border-red-200 bg-red-50 p-3 text-red-700"
              style={{ fontSize: 13 }}
            >
              {ordersError}
            </p>
          )}
          <div className="px-4">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-brand">
              Mandy&apos;s Rewards
            </p>
            <h1 className="mt-2 font-serif text-[40px] font-semibold leading-none tracking-[-0.03em] text-ink">
              Account
            </h1>
          </div>

          <div className="mt-7 grid gap-7 px-4 lg:grid-cols-[340px_1fr] lg:items-start">
            {/* Left: sticky profile summary + member cards */}
            <div className="flex flex-col gap-4 lg:sticky lg:top-24">
              <ProfileSummaryCard
                name={displayName}
                phone={prettyPhone(profile.phone_e164 ?? "")}
                tier={tier}
                balance={currentStars}
                goal={goal}
                lifetime={lifetime}
                activeCount={activeOrders.length}
                onViewOrders={() => router.push("/account/orders")}
              />
              <Flush>
                <AddToWalletButton />
              </Flush>
              <Flush>
                <WelcomeDiscountCard />
              </Flush>
              <Flush>
                <IgFollowPromoCard />
              </Flush>
              <Flush>
                <PromotionsCard rewardsCount={rewardsAvailable} />
              </Flush>
            </div>

            {/* Right: rewards + settings */}
            <div className="flex flex-col gap-7">
              <section>
                <h2 className="mb-4 font-serif text-[22px] font-semibold tracking-[-0.4px] text-ink">
                  Rewards
                </h2>
                <div className="grid gap-[18px] lg:grid-cols-[1.5fr_1fr] lg:items-start">
                  <div>
                    <Flush>
                      <LoyaltyCard
                        balance={balance}
                        starsPerReward={goal}
                        lifetimePoints={lifetime}
                        freeToppingsRemaining={
                          tier === "diamond" ? freeToppingsRemaining : null
                        }
                      />
                    </Flush>
                    <TierPerksChips tier={tier} />
                  </div>
                  <div className="flex flex-col gap-3.5">
                    <Flush>
                      <MemberQrCard
                        customerId={profile.square_customer_id}
                        phoneE164={profile.phone_e164}
                      />
                    </Flush>
                    <RewardStatsRow
                      drinks={lifetime}
                      rewards={rewardsAvailable}
                      stars={currentStars}
                    />
                  </div>
                </div>
              </section>

              <HowItWorks />

              <section>
                <h2 className="mb-4 font-serif text-[22px] font-semibold tracking-[-0.4px] text-ink">
                  Settings
                </h2>
                <AccountSettings
                  activeCount={activeOrders.length}
                  rewardsCount={rewardsAvailable}
                  onViewOrders={() => router.push("/account/orders")}
                  onViewPromotions={() => router.push("/account/promotions")}
                />
              </section>

              {/* Functional order history + activity (kept from prior page) */}
              <div className="flex flex-col gap-4">
                {orders.length === 0 ? (
                  <Flush>
                    <OrderHistory orders={[]} title="Orders" />
                  </Flush>
                ) : (
                  <>
                    <Flush>
                      <OrderHistory
                        orders={activeOrders}
                        title="In Progress"
                        hideIfEmpty
                      />
                    </Flush>
                    <Flush>
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
                    </Flush>
                  </>
                )}
                <Flush>
                  <ActivityHistory />
                </Flush>
              </div>

              <StoreCard />

              <div className="flex flex-wrap items-center gap-3">
                <Flush>
                  <SignOutBtn onSignOut={signOut} />
                </Flush>
                <Flush>
                  <DeleteAccountBtn />
                </Flush>
              </div>
              <p className="text-center text-[11.5px] text-ink4">
                Mandy&apos;s Bubble Tea · Web v2.0 · Southport QLD
              </p>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
