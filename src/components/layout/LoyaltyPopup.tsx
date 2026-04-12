"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BRAND, LOYALTY } from "@/lib/constants";

const PHONE_KEY = "mbt:account:phone";

export function LoyaltyPopup() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const phone = window.localStorage.getItem(PHONE_KEY);
      if (!phone) setVisible(true);
    } catch {
      // localStorage unavailable — don't show
    }
  }, []);

  if (!visible) return null;

  const total = LOYALTY.starsPerReward;
  const earned = 6; // demo progress
  const remaining = total - earned;

  function dismiss() {
    setVisible(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={dismiss}
    >
      <div
        className="relative w-full max-w-md rounded-2xl p-6 shadow-2xl sm:p-8"
        style={{ backgroundColor: BRAND.accentColor }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={dismiss}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-black/10 hover:text-zinc-800"
          aria-label="Close"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Header */}
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
          style={{ backgroundColor: "#F5E6C8", color: BRAND.primaryColor }}
        >
          <span className="text-sm">+</span> LOYALTY PROGRAM
        </span>

        <h2 className="mt-4 text-2xl font-bold leading-tight tracking-tight text-zinc-900 sm:text-3xl">
          Earn Your Way to
          <br />a Free Cup
        </h2>

        <p className="mt-3 text-sm leading-relaxed text-zinc-600">
          Every purchase earns you stars.{" "}
          <span className="font-semibold text-zinc-900">
            Collect {total} stars
          </span>{" "}
          and get your next artisanal boba on us.
        </p>

        {/* Loyalty card */}
        <div className="mt-5 rounded-2xl bg-white p-5 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900">Your Progress</h3>
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{
                backgroundColor: `${BRAND.primaryColor}15`,
                color: BRAND.primaryColor,
              }}
            >
              {earned} / {total} Stars
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {Array.from({ length: total }).map((_, i) => {
              const isEarned = i < earned;
              return (
                <div
                  key={i}
                  className="flex aspect-square items-center justify-center rounded-full"
                  style={{
                    backgroundColor: isEarned ? "#E8D5C4" : BRAND.accentColor,
                    border: isEarned ? "none" : "2px dashed #D4C4B0",
                  }}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill={isEarned ? "#8B5E3C" : "#C4B5A3"}
                  >
                    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
                  </svg>
                </div>
              );
            })}
          </div>

          <div className="mt-4">
            <div
              className="h-2.5 w-full overflow-hidden rounded-full"
              style={{ backgroundColor: BRAND.accentColor }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(earned / total) * 100}%`,
                  backgroundColor: BRAND.primaryColor,
                }}
              />
            </div>
            <p className="mt-2 text-center text-xs text-zinc-500">
              Just {remaining} more sips to your free reward!
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/account"
            className="inline-flex items-center rounded-full px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: BRAND.primaryColor }}
            onClick={dismiss}
          >
            Join Rewards
          </Link>
          <button
            onClick={dismiss}
            className="inline-flex items-center rounded-full border border-black/15 px-6 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-black/5"
          >
            Maybe Later
          </button>
        </div>
      </div>
    </div>
  );
}
