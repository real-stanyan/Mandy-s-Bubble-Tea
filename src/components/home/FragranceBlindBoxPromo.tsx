"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BRAND } from "@/lib/constants";

// Limited-time campaign card: "Buy 2 drinks, get a fragrance-tag blind
// box." Marketing only — the blind box is handed out in-store at pickup,
// so this just links to the menu. Visual treatment mirrors DailySpecial /
// the peach welcome cards. Gated by FRAGRANCE_BLIND_BOX_PROMO in page.tsx.
//
// Tags are uniform background-removed, string-stripped square crops. We
// show 5 of the 10 designs, re-shuffled on each load so refreshes surprise.

const POOL = [
  "black-opium",
  "cedarwood",
  "cherry",
  "crisp-apple",
  "freesia",
  "ocean",
  "rose",
  "sandalwood",
].map((n) => `/image/promo/fragrance-tags/${n}.png`);

const SHOW = 5;
// Fan angles + stacking, centre tag upright and on top.
const ROT = ["-16deg", "-8deg", "0deg", "8deg", "16deg"];
const Z = [1, 2, 3, 2, 1];

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function FragranceBlindBoxPromo() {
  // Deterministic first render (matches SSR), then shuffle on mount so each
  // page load shows a fresh random 5 without a hydration mismatch.
  const [tags, setTags] = useState<string[]>(() => POOL.slice(0, SHOW));
  useEffect(() => {
    setTags(shuffle(POOL).slice(0, SHOW));
  }, []);

  return (
    <section className="px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/menu"
          className="group flex flex-col gap-5 overflow-hidden rounded-3xl border border-black/10 p-6 shadow-sm transition hover:shadow-md sm:flex-row sm:items-stretch sm:gap-6 sm:p-8"
          style={{
            backgroundImage:
              "linear-gradient(115deg, #FFB380 0%, #FFCFA3 55%, #FFF3DE 100%)",
          }}
          aria-label="Buy 2 drinks, get a fragrance-tag blind box — order now"
        >
          {/* Copy (desktop CTA sits at the bottom of this column) */}
          <div className="flex min-w-0 flex-1 flex-col sm:justify-between">
            <div>
              <span className="inline-block rounded bg-[#2A1E14] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#FFF3DE] sm:text-[10px] sm:tracking-[0.13em]">
                Limited · While stocks last
              </span>
              <h2 className="mt-3 font-serif text-[28px] leading-[1.05] text-[#2A1E14] sm:text-3xl md:text-4xl">
                2 drinks, <span className="italic">one surprise</span>
              </h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-[#5A4330] sm:text-base">
                Buy any 2 drinks, get a fragrance-tag blind box — 10 designs, 10
                scents.
              </p>
            </div>
            <span
              className="mt-5 hidden w-fit items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white transition group-hover:opacity-90 sm:inline-flex"
              style={{ backgroundColor: BRAND.primaryColor }}
            >
              Order now →
            </span>
          </div>

          {/* Blind-box teaser: 5 random uniform tags, fanned. On mobile this
              sits between the copy and the CTA with breathing room so the
              rotated tiles never clip against the card edge. */}
          <div className="flex items-end justify-center -space-x-4 self-center py-1 sm:-space-x-8 sm:py-0">
            {tags.map((src, i) => (
              <span
                key={src}
                className="overflow-hidden rounded-xl shadow-md ring-1 ring-black/5"
                style={{ transform: `rotate(${ROT[i]})`, zIndex: Z[i] }}
              >
                <Image
                  src={src}
                  alt=""
                  width={440}
                  height={440}
                  className="h-[66px] w-[66px] object-cover sm:h-24 sm:w-24"
                />
              </span>
            ))}
          </div>

          {/* CTA — mobile only, centered below the fan */}
          <span
            className="inline-flex items-center justify-center gap-1.5 self-center rounded-full px-6 py-2.5 text-sm font-semibold text-white transition group-hover:opacity-90 sm:hidden"
            style={{ backgroundColor: BRAND.primaryColor }}
          >
            Order now →
          </span>
        </Link>
      </div>
    </section>
  );
}
