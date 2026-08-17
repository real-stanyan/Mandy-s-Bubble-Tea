"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BRAND, LOYALTY } from "@/lib/constants";
import { useAuth } from "@/components/auth/AuthProvider";
import { IgFollowPromoCard } from "@/components/account/IgFollowPromoCard";

type PromotionItem = {
  id: string;
  title: string;
  description: string;
  available: boolean;
  tag?: string;
};

export default function PromotionsPage() {
  const { profile, loyalty, welcomeDiscount, starsPerReward, loading } = useAuth();

  // Mystery-box coupons come from their own endpoint (they live in
  // Supabase, not the auth context). Empty until fetched — the rest of the
  // page renders without waiting.
  const [mysteryCoupons, setMysteryCoupons] = useState<
    Array<{ label: string; expiresAt: string }>
  >([]);
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    fetch("/api/me/mystery-coupons")
      .then((r) => r.json())
      .then((body: { coupons?: Array<{ label: string; expiresAt: string }> }) => {
        if (!cancelled && body?.coupons) setMysteryCoupons(body.coupons);
      })
      .catch(() => {
        /* the section just stays absent */
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const promotions = useMemo<PromotionItem[]>(() => {
    if (!profile) return getGuestPromotions();

    const balance = loyalty?.balance ?? 0;
    const perReward = starsPerReward || LOYALTY.starsPerReward;
    const rewardsAvailable = Math.floor(balance / perReward);

    const list: PromotionItem[] = [];
    if (welcomeDiscount.available) {
      const remaining = welcomeDiscount.drinksRemaining;
      const drinkWord = remaining === 1 ? "drink" : "drinks";
      list.push({
        id: "welcome-discount",
        title: `Welcome ${welcomeDiscount.percentage || 30}% Off`,
        description: `${remaining} ${drinkWord} left — auto-applied to your cheapest drinks at checkout.`,
        available: true,
        tag: "ACTIVE",
      });
    }
    for (const c of mysteryCoupons) {
      const until = new Date(c.expiresAt).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        timeZone: "Australia/Brisbane",
      });
      list.push({
        id: `mystery-${c.label}-${c.expiresAt}`,
        title: `🎁 ${c.label}`,
        description: `From Mandy's mystery box — auto-applied at checkout, valid until ${until}.`,
        available: true,
        tag: "ACTIVE",
      });
    }
    list.push(...buildPromotions(balance, perReward, rewardsAvailable));
    return list;
  }, [profile, loyalty, welcomeDiscount, starsPerReward, mysteryCoupons]);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="w-full bg-cream px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-2xl">
          <Link
            href="/account"
            className="mb-2 flex items-center gap-1 text-sm text-zinc-600 transition hover:text-zinc-900"
          >
            <span aria-hidden="true">←</span> Account
          </Link>
          <h1
            className="text-2xl font-bold italic tracking-tight sm:text-3xl"
            style={{ color: BRAND.primaryColor }}
          >
            Promotions
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Your rewards and special offers.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {loading ? (
          <div className="flex justify-center py-12">
            <div
              className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"
              style={{ borderColor: `${BRAND.primaryColor}33`, borderTopColor: BRAND.primaryColor }}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <IgFollowPromoCard />
            {promotions.length === 0 ? (
              <div className="rounded-2xl border border-black/10 bg-white p-8 text-center">
                <p className="text-sm text-zinc-500">No promotions available right now.</p>
                <Link
                  href="/menu"
                  className="mt-4 inline-block rounded-full px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
                  style={{ backgroundColor: BRAND.primaryColor }}
                >
                  Start ordering to earn stars
                </Link>
              </div>
            ) : (
              promotions.map((promo) => (
                <div
                  key={promo.id}
                  className={`relative overflow-hidden rounded-2xl border bg-white p-5 shadow-sm transition ${
                    promo.available
                      ? "border-black/10"
                      : "border-black/5 opacity-60"
                  }`}
                >
                  {promo.tag && (
                    <span
                      className="absolute top-4 right-4 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                      style={{ backgroundColor: BRAND.primaryColor }}
                    >
                      {promo.tag}
                    </span>
                  )}
                  <h3 className="text-base font-bold text-zinc-900 pr-20">
                    {promo.title}
                  </h3>
                  <p className="mt-1 text-sm text-zinc-600">
                    {promo.description}
                  </p>
                  {promo.available && (
                    <Link
                      href="/menu"
                      className="mt-3 inline-block rounded-full px-5 py-2 text-xs font-semibold text-white transition hover:opacity-90"
                      style={{ backgroundColor: BRAND.primaryColor }}
                    >
                      Use Now
                    </Link>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function buildPromotions(
  balance: number,
  starsPerReward: number,
  rewardsAvailable: number,
): PromotionItem[] {
  const promos: PromotionItem[] = [];

  if (rewardsAvailable > 0) {
    promos.push({
      id: "reward-free-drink",
      title: `🎉 Free Drink${rewardsAvailable > 1 ? ` ×${rewardsAvailable}` : ""}`,
      description: `You have ${rewardsAvailable} free drink${rewardsAvailable > 1 ? "s" : ""} to redeem! Choose any drink from the menu.`,
      available: true,
      tag: "Ready",
    });
  }

  const starsToNext = starsPerReward - (balance % starsPerReward);
  if (starsToNext > 0 && starsToNext < starsPerReward) {
    promos.push({
      id: "progress-next-reward",
      title: `⭐ ${starsToNext} more star${starsToNext !== 1 ? "s" : ""} to a free drink`,
      description: `You have ${balance} stars. Earn ${starsToNext} more to unlock your next free drink reward!`,
      available: false,
    });
  }

  promos.push({
    id: "welcome-loyalty",
    title: "☕ Earn Stars with Every Order",
    description: `Every drink earns you 1 star. Collect ${starsPerReward} stars and get a free drink of your choice!`,
    available: false,
  });

  return promos;
}

function getGuestPromotions(): PromotionItem[] {
  return [
    {
      id: "guest-join",
      title: "☕ Join Our Rewards Program",
      description: `Sign in to start earning stars. Collect ${LOYALTY.starsPerReward} stars and get a free drink of your choice!`,
      available: false,
    },
  ];
}
