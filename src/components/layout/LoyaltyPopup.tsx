"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BRAND, LOYALTY, FRAGRANCE_BLIND_BOX_PROMO } from "@/lib/constants";
import { useAuth } from "@/components/auth/AuthProvider";
import { APP_DOWNLOAD_DISMISS_KEY } from "@/components/home/AppDownloadPopup";

// Guest welcome popup (shown only to logged-out visitors). When the
// fragrance blind-box campaign is live it leads with the activity as a
// peach hero (matching the homepage card) and demotes loyalty to a slim
// strip. When the flag is off it falls back to a clean loyalty-only card,
// so the popup never breaks once the campaign ends.

// Five tags fanned in the hero — pulled from the same set the homepage
// card uses. Fixed (no shuffle) so the popup render stays deterministic.
const HERO_TAGS = ["cedarwood", "cherry", "ocean", "rose", "freesia"].map(
  (n) => `/image/promo/fragrance-tags/${n}.png`,
);
const HERO_ROT = ["-16deg", "-8deg", "0deg", "8deg", "16deg"];
const HERO_Z = [1, 2, 3, 2, 1];
const PEACH = "linear-gradient(120deg, #FFB380 0%, #FFCFA3 52%, #FFF3DE 100%)";

export function LoyaltyPopup() {
  const { profile, loading } = useAuth();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (loading || profile) {
      setVisible(false);
      return;
    }
    // Yield to the app-download campaign popup: while it's still eligible
    // (logged-out visitor who hasn't dismissed/claimed it), stay hidden so
    // logged-out visitors never see two popups at once. Once it's dismissed,
    // this falls back in on subsequent loads.
    let appDownloadPending = true;
    try {
      appDownloadPending =
        localStorage.getItem(APP_DOWNLOAD_DISMISS_KEY) !== "1";
    } catch {
      appDownloadPending = false;
    }
    setVisible(!appDownloadPending);
  }, [loading, profile]);

  if (!visible) return null;

  const goal = LOYALTY.starsPerReward;

  function dismiss() {
    setVisible(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={dismiss}
    >
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-3xl shadow-2xl"
        style={{ backgroundColor: "#FFFDF8" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close — neutral chip that reads on both the peach hero and white */}
        <button
          onClick={dismiss}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/10 text-zinc-700 transition hover:bg-black/20"
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {FRAGRANCE_BLIND_BOX_PROMO ? (
          <>
            {/* ── Activity hero (peach) ── */}
            <div className="px-6 pb-5 pt-7" style={{ backgroundImage: PEACH }}>
              <span className="inline-block rounded bg-[#2A1E14] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#FFF3DE] sm:text-[10px]">
                Limited · While stocks last
              </span>
              <h2 className="mt-3 font-serif text-[30px] leading-[1.02] tracking-tight text-[#2A1E14]">
                2 drinks,
                <br />
                <span className="italic">one surprise</span>
              </h2>
              <p className="mt-2 max-w-[28ch] text-[13px] leading-snug text-[#5A4330]">
                Buy any 2 drinks, get a fragrance-tag blind box — 10 designs, 10
                scents.
              </p>

              <div className="mt-4 flex items-end justify-center">
                {HERO_TAGS.map((src, i) => (
                  <span
                    key={src}
                    className="overflow-hidden rounded-xl border-2 border-white bg-white shadow-lg"
                    style={{
                      transform: `rotate(${HERO_ROT[i]})`,
                      zIndex: HERO_Z[i],
                      marginLeft: i === 0 ? 0 : -22,
                    }}
                  >
                    <Image
                      src={src}
                      alt=""
                      width={440}
                      height={440}
                      className="h-[58px] w-[58px] object-cover"
                    />
                  </span>
                ))}
              </div>
            </div>

            {/* ── Body: slim loyalty strip + CTAs ── */}
            <div className="px-6 pb-6 pt-4">
              <div className="flex items-center gap-3 rounded-2xl border border-[#E8DBC8] px-3.5 py-3">
                <div className="flex shrink-0 gap-1">
                  {Array.from({ length: goal }).map((_, i) => (
                    <span
                      key={i}
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: BRAND.primaryColor,
                        opacity: i === goal - 1 ? 1 : 0.28,
                      }}
                    />
                  ))}
                </div>
                <p className="text-xs leading-snug text-[#6B5440]">
                  <span className="font-semibold text-[#2A1E14]">
                    Plus — join rewards.
                  </span>{" "}
                  {goal} stars = a drink on us.
                </p>
              </div>

              <div className="mt-4 flex flex-col gap-2.5">
                <Link
                  href="/menu"
                  onClick={dismiss}
                  className="inline-flex items-center justify-center gap-1.5 rounded-full px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                  style={{ backgroundColor: BRAND.primaryColor }}
                >
                  See the menu →
                </Link>
                <Link
                  href="/account"
                  onClick={dismiss}
                  className="inline-flex items-center justify-center rounded-full border border-black/10 px-6 py-2.5 text-sm font-semibold text-[#6B5440] transition hover:bg-black/[0.04]"
                >
                  Join rewards &amp; earn stars
                </Link>
              </div>
            </div>
          </>
        ) : (
          /* ── Fallback: loyalty-only (campaign ended) ── */
          <div className="px-6 pb-6 pt-7">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: BRAND.primaryColor }}>
              Rewards
            </span>
            <h2 className="mt-2.5 font-serif text-[26px] leading-[1.08] tracking-tight text-[#2A1E14]">
              Your way to a{" "}
              <span className="italic" style={{ color: BRAND.primaryColor }}>
                free cup
              </span>
            </h2>
            <p className="mt-2 max-w-[30ch] text-[13px] leading-relaxed text-[#6B5440]">
              Every drink earns a star. Collect {goal} — the next one&apos;s on
              us.
            </p>

            <div className="mt-5 flex items-center gap-1.5">
              {Array.from({ length: goal }).map((_, i) => (
                <svg
                  key={i}
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill={BRAND.primaryColor}
                  style={{ opacity: i === goal - 1 ? 1 : 0.3 }}
                >
                  <path d="M12 2l2.6 7.0H22l-6.0 4.4 2.3 7.0L12 16.0l-6.0 4.4 2.3-7.0L2 9.0h7.4z" />
                </svg>
              ))}
              <span
                className="ml-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold"
                style={{ backgroundColor: "rgba(141,85,36,0.10)", color: BRAND.primaryColor }}
              >
                {goal}th = free 🧋
              </span>
            </div>

            <div className="mt-6 flex flex-col gap-2.5">
              <Link
                href="/account"
                onClick={dismiss}
                className="inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                style={{ backgroundColor: BRAND.primaryColor }}
              >
                Join rewards
              </Link>
              <button
                onClick={dismiss}
                className="inline-flex items-center justify-center rounded-full px-6 py-2 text-sm font-medium text-zinc-500 transition hover:text-zinc-700"
              >
                Maybe later
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
