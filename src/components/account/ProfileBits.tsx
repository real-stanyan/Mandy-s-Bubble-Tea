"use client";

import type { ReactNode } from "react";
import {
  ShoppingBag,
  Star,
  Gift,
  MapPin,
  Clock,
  Check,
  ChevronRight,
  FlaskConical,
} from "lucide-react";
import type { MembershipTier } from "@/lib/membership-tier";
import { BUSINESS } from "@/lib/constants";

// Presentational building blocks for the redesigned signed-in Account
// (Profile) page — recreated from design_handoff_account_auth's
// web-account.jsx ProfilePage. All pure props so they render in the
// dev-only preview route with mock data (no auth session needed).

/** Tier perks copy from the design's data.js `TIER_PERKS`. */
export function tierPerks(tier: MembershipTier): string[] {
  switch (tier) {
    case "diamond":
      return ["5% off online orders", "10 free toppings / month", "Free drink at 9★"];
    case "gold":
      return ["5% off online orders", "Free drink at 9★"];
    default:
      return ["1★ per drink", "Free drink at 9★"];
  }
}

export function initialsFor(name: string): string {
  const ini = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  return ini || "MZ";
}

export function ProfileSummaryCard({
  name,
  phone,
  tier,
  balance,
  goal,
  lifetime,
  activeCount,
  onViewOrders,
}: {
  name: string;
  phone: string;
  tier: MembershipTier;
  balance: number;
  goal: number;
  lifetime: number;
  activeCount: number;
  onViewOrders?: () => void;
}) {
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  return (
    <div className="rounded-card border border-line bg-card p-6 text-center shadow-[0_2px_8px_rgba(42,30,20,0.05)]">
      <div
        className="mx-auto grid h-[76px] w-[76px] place-items-center rounded-full bg-gradient-to-br from-peach to-brand"
        style={{ boxShadow: "0 8px 18px rgba(141,85,36,0.4)" }}
      >
        <span className="font-serif text-[28px] tracking-[-0.5px] text-white">
          {initialsFor(name)}
        </span>
      </div>
      <h2 className="mt-3.5 font-serif text-[22px] font-semibold tracking-[-0.4px] text-ink">
        {name}
      </h2>
      <p className="mt-1 font-mono text-[12.5px] text-ink3">{phone}</p>
      <span className="mt-3.5 inline-flex items-center gap-1.5 rounded-full bg-cream px-3.5 py-[7px]">
        <Star size={13} className="fill-brand text-brand" />
        <span className="text-[12.5px] font-semibold text-brand">
          {tierLabel} member
        </span>
      </span>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-tile border border-line bg-paper px-2.5 py-3.5 text-center">
          <div className="font-serif text-[20px] font-semibold text-brand">
            {balance}/{goal}
          </div>
          <div className="mt-0.5 text-[11px] font-semibold text-ink3">Stars</div>
        </div>
        <div className="rounded-tile border border-line bg-paper px-2.5 py-3.5 text-center">
          <div className="font-serif text-[20px] font-semibold text-ink">
            {lifetime}
          </div>
          <div className="mt-0.5 text-[11px] font-semibold text-ink3">
            Lifetime
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onViewOrders}
        className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-full border border-line bg-card px-4 py-2.5 text-[13px] font-semibold text-ink2 transition hover:bg-paper"
      >
        <ShoppingBag size={15} /> Your orders
        {activeCount > 0 ? ` · ${activeCount} active` : ""}
      </button>
    </div>
  );
}

export function TierPerksChips({ tier }: { tier: MembershipTier }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {tierPerks(tier).map((perk) => (
        <span
          key={perk}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-[7px] text-[12.5px] font-semibold text-ink2"
        >
          <Check size={13} className="text-green-dark" /> {perk}
        </span>
      ))}
    </div>
  );
}

export function RewardStatsRow({
  drinks,
  rewards,
  stars,
}: {
  drinks: number;
  rewards: number;
  stars: number;
}) {
  const items: [string, number][] = [
    ["Drinks", drinks],
    ["Rewards", rewards],
    ["Stars", stars],
  ];
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {items.map(([label, val]) => (
        <div
          key={label}
          className="rounded-card border border-line bg-card px-2 py-3.5 text-center shadow-[0_2px_8px_rgba(42,30,20,0.05)]"
        >
          <div className="font-serif text-[24px] font-semibold text-brand">
            {val}
          </div>
          <div className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-ink3">
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}

export function HowItWorks() {
  const steps: [ReactNode, string, string][] = [
    [<ShoppingBag key="b" size={17} />, "Order & earn", "One star per drink, in-store or online."],
    [<Star key="s" size={17} />, "Stack nine", "Nine stars fills your card."],
    [<Gift key="g" size={17} />, "Sip free", "Redeem a free drink, on us."],
  ];
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
      {steps.map(([icon, title, desc], i) => (
        <div
          key={title}
          className="rounded-card border border-line bg-card p-[18px] shadow-[0_2px_8px_rgba(42,30,20,0.05)]"
        >
          <div className="flex items-center gap-2.5">
            <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-cream text-brand">
              {icon}
            </span>
            <span className="font-mono text-[11px] font-bold text-ink4">
              0{i + 1}
            </span>
          </div>
          <h3 className="mt-3 font-serif text-base font-semibold tracking-[-0.2px] text-ink">
            {title}
          </h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink2">{desc}</p>
        </div>
      ))}
    </div>
  );
}

export function SettingsGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-[22px]">
      <div className="mb-2.5 pl-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-ink3">
        {label}
      </div>
      <div className="overflow-hidden rounded-card border border-line bg-card shadow-[0_2px_8px_rgba(42,30,20,0.05)]">
        {children}
      </div>
    </div>
  );
}

export function NavRow({
  icon,
  label,
  detail,
  onClick,
  last,
}: {
  icon: ReactNode;
  label: string;
  detail?: string;
  onClick?: () => void;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-paper ${
        last ? "" : "border-b border-line"
      }`}
    >
      <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-cream text-brand">
        {icon}
      </span>
      <span className="flex-1 text-sm font-semibold text-ink">{label}</span>
      {detail && <span className="text-[12.5px] text-ink3">{detail}</span>}
      <ChevronRight size={16} className="text-ink4" />
    </button>
  );
}

export function StoreCard() {
  return (
    <div className="rounded-card border border-line bg-card p-[22px] shadow-[0_2px_8px_rgba(42,30,20,0.05)]">
      <div className="flex items-start gap-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-cream text-brand">
          <MapPin size={18} />
        </span>
        <div>
          <p className="text-[14.5px] font-semibold text-ink">
            Mandy&apos;s · Southport
          </p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink3">
            {BUSINESS.address}
          </p>
        </div>
        <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-semibold text-ink2">
          <Clock size={14} className="text-brand" /> 10:30–22:30
        </span>
      </div>
    </div>
  );
}

// Settings rows the app can actually fulfil today (route to real pages).
// The design's prototype-only rows — Order/Email toggles, "•••• 4215"
// Payment methods, "2 saved" Saved addresses, and the TierSwitch preview
// control — are intentionally omitted: they have no backend yet and
// shipping them would be dead UI. Add them back when wired.
export function AccountSettings({
  activeCount,
  rewardsCount,
  onViewOrders,
  onViewPromotions,
}: {
  activeCount: number;
  rewardsCount: number;
  onViewOrders?: () => void;
  onViewPromotions?: () => void;
}) {
  return (
    <div>
      <SettingsGroup label="Activity">
        <NavRow
          icon={<ShoppingBag size={15} />}
          label="Your orders"
          detail={activeCount > 0 ? `${activeCount} active` : "History"}
          onClick={onViewOrders}
        />
        <NavRow
          icon={<Gift size={15} />}
          label="Promotions & offers"
          detail={rewardsCount > 0 ? `${rewardsCount} ready` : undefined}
          onClick={onViewPromotions}
          last
        />
      </SettingsGroup>
      <SettingsGroup label="About">
        <NavRow
          icon={<FlaskConical size={15} />}
          label="Our story"
          onClick={() => {
            window.location.href = "/our-story";
          }}
        />
        <NavRow
          icon={<Star size={15} />}
          label="Privacy & terms"
          onClick={() => {
            window.location.href = "/privacy";
          }}
          last
        />
      </SettingsGroup>
    </div>
  );
}
