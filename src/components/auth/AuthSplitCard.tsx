"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AuthForm } from "@/components/auth/AuthForm";

// Desktop two-panel sign-in card for the Account route (signed-out).
// Left = brand panel (perks live here); right = the form. Collapses to a
// single column below 860px, where the form switches to the compact
// "card" variant (hero + perks inline) to match the mobile design.

function useIsWide(min = 860): boolean {
  // SSR + first client render default to false (mobile-first) so the
  // markup matches; flip after mount once we can measure.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${min}px)`);
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [min]);
  return wide;
}

export function AuthSplitCard({ onComplete }: { onComplete?: () => void }) {
  const wide = useIsWide(860);

  if (!wide) {
    // Narrow: the standard compact card (hero + perks inline).
    return (
      <div className="mx-auto w-full max-w-md px-4 pt-2">
        <div className="rounded-card border border-line bg-card p-6 shadow-[0_2px_8px_rgba(42,30,20,0.05)] sm:p-8">
          <AuthForm variant="card" onComplete={onComplete} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid place-items-center px-10 pb-16 pt-2">
      <div
        className="grid w-full max-w-[980px] overflow-hidden rounded-[28px] bg-card"
        style={{
          gridTemplateColumns: "1.02fr 1fr",
          boxShadow: "0 18px 44px rgba(42,30,20,0.14)",
        }}
      >
        {/* Left brand panel */}
        <div
          className="relative flex flex-col border-r border-line p-12"
          style={{
            background:
              "linear-gradient(165deg,#FFF7EC 0%,#FCEAD2 55%,#F6DDBE 100%)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.webp"
            alt="Mandy's Bubble Tea"
            width={52}
            height={52}
            className="h-[52px] w-[52px] object-contain"
          />
          <h2 className="mt-6 max-w-[320px] font-serif text-[34px] font-semibold leading-tight tracking-[-0.03em] text-[#2A1E14]">
            Rewards that stack up, sip by sip.
          </h2>
          <p className="mt-3 max-w-[340px] text-sm leading-relaxed text-[#5A4330]">
            Join Mandy&apos;s Rewards to earn a star with every drink, redeem a
            free one at nine, and unlock member-only seasonal sips.
          </p>

          <div className="mt-8 flex flex-col gap-4">
            <PerkRow
              icon={<StarGlyph />}
              title="A star for every drink"
              sub="In-store or online — they add up fast."
            />
            <PerkRow
              icon={<GiftGlyph />}
              title="Free drink at nine stars"
              sub="Your loyalty card, always in your pocket."
            />
            <PerkRow
              icon={<FlaskGlyph />}
              title="Member-only sips"
              sub="First dibs on seasonal specials."
            />
          </div>

          <div className="mt-auto flex items-center gap-2 pt-10 text-[12.5px] font-medium text-[#5A4330]">
            <span className="inline-block h-2 w-2 rounded-full bg-green" />
            Mandy&apos;s · Southport — open daily 10:30 am – 10:30 pm
          </div>
        </div>

        {/* Right form panel */}
        <div className="flex flex-col justify-center p-11">
          <AuthForm variant="panel" onComplete={onComplete} />
        </div>
      </div>
    </div>
  );
}

function PerkRow({
  icon,
  title,
  sub,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-[#FFFDF8] text-[#8D5524] shadow-[0_2px_8px_rgba(42,30,20,0.05)]">
        {icon}
      </span>
      <div>
        <p className="text-[14.5px] font-semibold text-[#2A1E14]">{title}</p>
        <p className="text-[12.5px] text-[#8A7263]">{sub}</p>
      </div>
    </div>
  );
}

function StarGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l2.9 6.26L21.5 9l-4.75 4.5L17.9 21 12 17.27 6.1 21l1.15-7.5L2.5 9l6.6-.74L12 2z" />
    </svg>
  );
}
function GiftGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /><path d="M12 8C12 8 10.5 3 7.5 4.5 5.5 5.5 7 8 12 8zM12 8c0 0 1.5-5 4.5-3.5C18.5 5.5 17 8 12 8z" />
    </svg>
  );
}
function FlaskGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 3h6M10 3v6.5L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-8.5V3" /><path d="M7.5 14h9" />
    </svg>
  );
}
