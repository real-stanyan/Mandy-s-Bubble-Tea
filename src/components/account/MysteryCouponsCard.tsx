"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";

// Mystery-box prizes on the ACCOUNT page — the same card language as the
// Welcome Gift block above it, one card per live coupon. Exists because a
// won prize that only lived on /account/promotions read as "it vanished"
// (Stan, 2026-08-17). Labels + expiry only; checkout picks and burns the
// coupon itself.

type Coupon = { label: string; expiresAt: string };

export function MysteryCouponsCard() {
  const { profile } = useAuth();
  const [coupons, setCoupons] = useState<Coupon[]>([]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    fetch("/api/me/mystery-coupons")
      .then((r) => r.json())
      .then((body: { coupons?: Coupon[] }) => {
        if (!cancelled && body?.coupons) setCoupons(body.coupons);
      })
      .catch(() => {
        /* section stays absent */
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  if (coupons.length === 0) return null;

  return (
    <>
      {coupons.map((c) => {
        const until = new Date(c.expiresAt).toLocaleDateString("en-AU", {
          day: "numeric",
          month: "short",
          timeZone: "Australia/Brisbane",
        });
        return (
          <div key={`${c.label}-${c.expiresAt}`} className="px-4 mt-3">
            <section
              className="relative overflow-hidden rounded-card border border-line bg-paper p-4"
              aria-label="Mystery box prize"
            >
              <div className="pointer-events-none absolute -right-6 -top-6 h-32 w-32 rounded-full bg-peach/30" />
              <div className="relative flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className="font-mono uppercase text-brand"
                    style={{ fontSize: 10.5, letterSpacing: 1.3, fontWeight: 700 }}
                  >
                    🎁 Mystery Box Prize
                  </p>
                  <h3
                    className="mt-1 font-serif text-ink"
                    style={{ fontSize: 26, letterSpacing: -0.5, fontWeight: 500 }}
                  >
                    {c.label}
                  </h3>
                  <p
                    className="mt-1 text-ink2"
                    style={{ fontSize: 13, lineHeight: "18px" }}
                  >
                    Auto-applied at checkout · valid until {until}.
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
      })}
    </>
  );
}
