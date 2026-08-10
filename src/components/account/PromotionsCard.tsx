import Link from "next/link";
import { ArrowRight, Gift } from "lucide-react";

type PromotionsCardProps = {
  rewardsCount: number;
};

export function PromotionsCard({ rewardsCount }: PromotionsCardProps) {
  if (rewardsCount <= 0) return null;
  const drinkWord = rewardsCount === 1 ? "drink" : "drinks";

  return (
    <div className="px-4 mt-3">
      <Link
        href="/account/promotions"
        className="block rounded-card p-[22px] shadow-mini-cart transition-transform active:scale-[0.985]"
        style={{
          background: "linear-gradient(135deg, #FFB380 0%, #FFF3DE 100%)",
        }}
      >
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink" />
              {/* Pinned day ink throughout: the card keeps its peach poster
                  gradient in evening mode (inline style, out of reach of the
                  token remaps), so token ink would flip light-on-light.
                  Same idiom as the checkout Rewards Progress card. */}
              <span
                className="font-mono uppercase text-[#2A1E14]/65"
                style={{
                  fontSize: 10.5,
                  letterSpacing: 1.3,
                  fontWeight: 700,
                }}
              >
                FREE DRINKS READY
              </span>
            </div>
            <div className="mt-2 flex items-baseline">
              <span
                className="font-serif text-[#2A1E14]"
                style={{
                  fontSize: 36,
                  lineHeight: "36px",
                  letterSpacing: -0.8,
                  fontWeight: 500,
                }}
              >
                {rewardsCount}
              </span>
              <span
                className="font-serif text-[#2A1E14]/45 ml-1.5"
                style={{ fontSize: 18, fontWeight: 500 }}
              >
                {`free ${drinkWord}`}
              </span>
            </div>
          </div>
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-ink"
          >
            <Gift size={22} className="text-cream" />
          </div>
        </div>

        <div className="mt-[18px] flex items-center justify-between">
          <p
            className="flex-1 pr-3 text-[#2A1E14]/80"
            style={{ fontSize: 13, lineHeight: "19px" }}
          >
            Redeem at pickup — any size, any flavor on the menu.
          </p>
          <span className="flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5">
            <span
              className="text-cream"
              style={{ fontSize: 12.5, fontWeight: 500 }}
            >
              Redeem
            </span>
            <ArrowRight size={12} className="text-cream" />
          </span>
        </div>
      </Link>
    </div>
  );
}
