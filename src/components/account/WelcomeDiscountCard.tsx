"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";

export function WelcomeDiscountCard() {
  const { welcomeDiscount } = useAuth();
  if (!welcomeDiscount.available) return null;

  const { percentage, drinksRemaining } = welcomeDiscount;
  const remainingLabel =
    drinksRemaining === 1 ? "1 drink left" : `${drinksRemaining} drinks left`;

  return (
    <div className="px-4 mt-3">
      <section
        className="relative overflow-hidden rounded-card border border-line bg-paper p-4"
        aria-label="Welcome discount"
      >
        <div className="pointer-events-none absolute -right-6 -top-6 h-32 w-32 rounded-full bg-peach/30" />
        <div className="relative flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p
              className="font-mono uppercase text-brand"
              style={{
                fontSize: 10.5,
                letterSpacing: 1.3,
                fontWeight: 700,
              }}
            >
              Welcome Gift
            </p>
            <h3
              className="mt-1 font-serif text-ink"
              style={{
                fontSize: 26,
                letterSpacing: -0.5,
                fontWeight: 500,
              }}
            >
              {percentage}% OFF
            </h3>
            <p
              className="mt-1 text-ink2"
              style={{ fontSize: 13, lineHeight: "18px" }}
            >
              Your first 2 drinks — {remainingLabel}, auto-applied at checkout.
            </p>
          </div>
          <Link
            href="/menu"
            className="flex shrink-0 items-center gap-1 rounded-full bg-ink px-4 py-2 text-cream transition active:opacity-85"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            Menu
            <ArrowRight size={12} />
          </Link>
        </div>
      </section>
    </div>
  );
}
