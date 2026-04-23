import Link from "next/link";
import { ChevronRight, Gift } from "lucide-react";

type PromotionsCardProps = {
  rewardsCount: number;
};

export function PromotionsCard({ rewardsCount }: PromotionsCardProps) {
  if (rewardsCount <= 0) return null;
  const label = `${rewardsCount} free drink${rewardsCount === 1 ? "" : "s"} ready`;

  return (
    <div className="px-4 mt-3">
      <Link
        href="/account/promotions"
        className="flex items-center gap-3 rounded-card border p-4 transition active:opacity-90"
        style={{
          background: "linear-gradient(135deg, #FFB380 0%, #FFF3DE 100%)",
          borderColor: "rgba(141,85,36,0.12)",
        }}
      >
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-ink"
        >
          <Gift size={22} className="text-cream" />
        </div>
        <div className="min-w-0 flex-1">
          <span
            className="block font-serif text-ink"
            style={{
              fontSize: 17,
              letterSpacing: -0.3,
              fontWeight: 500,
            }}
          >
            {label}
          </span>
          <span
            className="mt-0.5 block text-ink2"
            style={{ fontSize: 12, lineHeight: "16px" }}
          >
            Redeem at pickup — any size, any flavor.
          </span>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-ink px-3 py-2">
          <span className="text-cream" style={{ fontSize: 12, fontWeight: 600 }}>
            Use
          </span>
          <ChevronRight size={12} className="text-cream" />
        </span>
      </Link>
    </div>
  );
}
