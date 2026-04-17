"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BRAND, LOYALTY } from "@/lib/constants";

const STORAGE_KEY = "mbt:account:phone";

type PromotionItem = {
  id: string;
  title: string;
  description: string;
  available: boolean;
  tag?: string;
};

export default function PromotionsPage() {
  const [loading, setLoading] = useState(true);
  const [promotions, setPromotions] = useState<PromotionItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const phone = window.localStorage.getItem(STORAGE_KEY);
        if (!phone) {
          setPromotions(getGuestPromotions());
          setLoading(false);
          return;
        }

        // Look up customer + loyalty to determine reward availability
        const res = await fetch("/api/customer/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone }),
        });
        if (!res.ok) {
          setPromotions(getGuestPromotions());
          setLoading(false);
          return;
        }
        const customer = await res.json();

        const loyaltyRes = await fetch("/api/loyalty/account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId: customer.customerId,
            phone,
          }),
        });
        const loyalty = await loyaltyRes.json();
        const balance: number = loyalty.balance ?? 0;
        const starsPerReward: number =
          loyalty.starsPerReward ?? LOYALTY.starsPerReward;
        const rewardsAvailable = Math.floor(balance / starsPerReward);

        let welcomeDiscountAvailable = false;
        let welcomeDiscountPct = 30;
        try {
          const wdRes = await fetch(
            `/api/welcome-discount/status?customerId=${encodeURIComponent(customer.customerId)}`,
          );
          const wd = await wdRes.json();
          welcomeDiscountAvailable = !!wd?.available;
          welcomeDiscountPct = wd?.percentage ?? 30;
        } catch {
          // Silent — promotions page is informational only.
        }

        const base = buildPromotions(balance, starsPerReward, rewardsAvailable);
        const list: PromotionItem[] = [];
        if (welcomeDiscountAvailable) {
          list.push({
            id: "welcome-discount",
            title: `Welcome ${welcomeDiscountPct}% Off`,
            description: "Auto-applied at checkout on your next order.",
            available: true,
            tag: "ACTIVE",
          });
        }
        list.push(...base);
        setPromotions(list);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPromotions(getGuestPromotions());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: BRAND.bgColor }}>
      <header
        className="w-full px-4 py-6 sm:px-6 sm:py-8"
        style={{ backgroundColor: BRAND.accentColor }}
      >
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
            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
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

  // Free drink reward(s)
  if (rewardsAvailable > 0) {
    promos.push({
      id: "reward-free-drink",
      title: `🎉 Free Drink${rewardsAvailable > 1 ? ` ×${rewardsAvailable}` : ""}`,
      description: `You have ${rewardsAvailable} free drink${rewardsAvailable > 1 ? "s" : ""} to redeem! Choose any drink from the menu.`,
      available: true,
      tag: "Ready",
    });
  }

  // Progress toward next reward
  const starsToNext = starsPerReward - (balance % starsPerReward);
  if (starsToNext > 0 && starsToNext < starsPerReward) {
    promos.push({
      id: "progress-next-reward",
      title: `⭐ ${starsToNext} more star${starsToNext !== 1 ? "s" : ""} to a free drink`,
      description: `You have ${balance} stars. Earn ${starsToNext} more to unlock your next free drink reward!`,
      available: false,
    });
  }

  // Always-on welcome promo
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
