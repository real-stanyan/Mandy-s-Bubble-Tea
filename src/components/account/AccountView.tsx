"use client";

import { type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Gift } from "lucide-react";
import type { MembershipTier } from "@/lib/membership-tier";
import { LoyaltyCard } from "@/components/account/LoyaltyCard";
import { TierUpCelebration } from "@/components/account/TierUpCelebration";
import {
  ProfileSummaryCard,
  ProfileSummaryCardCompact,
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
import { MysteryCouponsCard } from "@/components/account/MysteryCouponsCard";
import { OrderHistory } from "@/components/account/OrderHistory";
import { ActivityHistory } from "@/components/account/ActivityHistory";
import { SignOutBtn } from "@/components/account/SignOutBtn";
import { DeleteAccountBtn } from "@/components/account/DeleteAccountBtn";
import type { OrderHistoryItem } from "@/components/account/OrderRow";

// QR card touches `document` at module scope (qrcode.react) — client-only to
// avoid SSR mismatch, same as the original account page.
const MemberQrCard = dynamic(
  () => import("@/components/account/MemberQrCard").then((m) => m.MemberQrCard),
  { ssr: false },
);

// Presentational signed-in Account view — all data arrives via props so it
// renders both in the real /account page (real session) and the /dev/account
// preview (mock data). Two arrangements share one set of components:
//   - mobile (lg:hidden)  → follows design account.jsx order; AppBar owns the
//     "Account" title so there is no in-content heading.
//   - desktop (hidden lg:block) → the 2-column web-account.jsx layout, which
//     keeps its "Account" heading + sticky sidebar.

// Neutralizes legacy single-column self-margins on reused cards so the
// surrounding layout owns spacing (orders/promotions pages stay untouched).
function Flush({ children }: { children: ReactNode }) {
  return (
    <div className="[&>*]:!mx-0 [&>*]:!mt-0 [&>*]:!mb-0 [&>*]:!px-0">
      {children}
    </div>
  );
}

export type AccountViewProps = {
  displayName: string;
  phone: string;
  phoneE164: string;
  squareCustomerId: string;
  tier: MembershipTier;
  balance: number;
  currentStars: number;
  goal: number;
  lifetime: number;
  rewardsAvailable: number;
  freeToppingsRemaining: number | null;
  activeOrders: OrderHistoryItem[];
  pastOrders: OrderHistoryItem[];
  ordersError?: string | null;
  onViewOrders: () => void;
  onViewPromotions: () => void;
  onSignOut: () => void | Promise<void>;
};

export function AccountView(props: AccountViewProps) {
  const {
    displayName,
    phone,
    phoneE164,
    squareCustomerId,
    tier,
    balance,
    currentStars,
    goal,
    lifetime,
    rewardsAvailable,
    freeToppingsRemaining,
    activeOrders,
    pastOrders,
    ordersError,
    onViewOrders,
    onViewPromotions,
    onSignOut,
  } = props;

  const hasOrders = activeOrders.length + pastOrders.length > 0;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 pb-24 pt-6 lg:pt-10">
      <TierUpCelebration tier={tier} />
      {ordersError && (
        <p
          className="mx-4 mt-3 rounded-tile border border-red-200 bg-red-50 p-3 text-red-700"
          style={{ fontSize: 13 }}
        >
          {ordersError}
        </p>
      )}

      {/* ===================== MOBILE ===================== */}
      <div className="flex flex-col gap-5 px-4 lg:hidden">
        <ProfileSummaryCardCompact name={displayName} phone={phone} tier={tier} />

        <section>
          <div className="mb-3 flex items-center gap-2 pl-0.5">
            <Gift size={16} className="text-brand" />
            <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-ink3">
              Mandy&apos;s Rewards
            </h2>
          </div>
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
        </section>

        <RewardStatsRow
          drinks={lifetime}
          rewards={rewardsAvailable}
          stars={currentStars}
        />

        <Flush>
          <MemberQrCard
            customerId={squareCustomerId}
            phoneE164={phoneE164}
          />
        </Flush>

        <Flush>
          <AddToWalletButton />
        </Flush>

        {/* Real, functional offers — kept (no fake placeholder rows). */}
        <Flush>
          <WelcomeDiscountCard />
        </Flush>
        <Flush>
          <IgFollowPromoCard />
        </Flush>
        <Flush>
          <MysteryCouponsCard />
        </Flush>
        <Flush>
          <PromotionsCard rewardsCount={rewardsAvailable} />
        </Flush>

        <section>
          <AccountSettings
            activeCount={activeOrders.length}
            rewardsCount={rewardsAvailable}
            onViewOrders={onViewOrders}
            onViewPromotions={onViewPromotions}
          />
        </section>

        <div className="flex flex-col gap-4">
          {!hasOrders ? (
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
                    pastOrders.length > 3 ? onViewOrders : undefined
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

        <div className="flex flex-col gap-3">
          <Flush>
            <SignOutBtn onSignOut={onSignOut} />
          </Flush>
          <Flush>
            <DeleteAccountBtn />
          </Flush>
        </div>
        <p className="text-center text-[11.5px] text-ink4">
          Mandy&apos;s Bubble Tea · Web v2.0 · Southport QLD
        </p>
      </div>

      {/* ===================== DESKTOP ===================== */}
      <div className="hidden lg:block">
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
              phone={phone}
              tier={tier}
              balance={currentStars}
              goal={goal}
              lifetime={lifetime}
              activeCount={activeOrders.length}
              onViewOrders={onViewOrders}
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
                      customerId={squareCustomerId}
                      phoneE164={phoneE164}
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
                onViewOrders={onViewOrders}
                onViewPromotions={onViewPromotions}
              />
            </section>

            <div className="flex flex-col gap-4">
              {!hasOrders ? (
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
                      onSeeAll={pastOrders.length > 3 ? onViewOrders : undefined}
                    />
                  </Flush>
                </>
              )}
              <Flush>
                <ActivityHistory />
              </Flush>
            </div>

            <StoreCard />

            <div className="flex flex-col gap-3">
              <Flush>
                <SignOutBtn onSignOut={onSignOut} />
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
      </div>
    </main>
  );
}
