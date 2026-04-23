import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import { StarCupsRow } from "@/components/brand/StarCupsRow";

type LoyaltyCardProps = {
  balance: number;
  starsPerReward: number;
};

export function LoyaltyCard({ balance, starsPerReward }: LoyaltyCardProps) {
  const goal = starsPerReward > 0 ? starsPerReward : 1;
  const currentStars = balance % goal;
  const toGo = Math.max(0, goal - currentStars);
  const reached = balance >= goal;

  return (
    <div className="px-4 mt-3">
      <Link
        href="/account/promotions"
        className="block rounded-card bg-gradient-to-br from-brand to-brand-dark p-[22px] shadow-mini-cart transition-transform active:scale-[0.985]"
      >
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-peach" />
              <span
                className="font-mono uppercase text-white/70"
                style={{
                  fontSize: 10.5,
                  letterSpacing: 1.3,
                  fontWeight: 700,
                }}
              >
                MANDY&apos;S REWARDS
              </span>
            </div>
            <div className="mt-2 flex items-baseline">
              <span
                className="font-serif text-white"
                style={{
                  fontSize: 36,
                  lineHeight: "36px",
                  letterSpacing: -0.8,
                  fontWeight: 500,
                }}
              >
                {balance}
              </span>
              <span
                className="font-serif text-white/45 ml-1.5"
                style={{ fontSize: 24, fontWeight: 500 }}
              >
                {` / ${goal} stars`}
              </span>
            </div>
          </div>
          <span className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1.5">
            <Star size={12} className="text-peach" fill="currentColor" />
            <span
              className="text-white"
              style={{ fontSize: 11, fontWeight: 500 }}
            >
              Member
            </span>
          </span>
        </div>

        <StarCupsRow value={currentStars} total={goal} />

        <div className="mt-[18px] flex items-center justify-between">
          <p
            className="flex-1 pr-3 text-white/85"
            style={{ fontSize: 13, lineHeight: "19px" }}
          >
            {reached ? (
              <>🎉 Free drink ready to redeem</>
            ) : (
              <>
                <span
                  className="text-white"
                  style={{ fontWeight: 600 }}
                >
                  {toGo}
                </span>
                {" stars until a free drink"}
              </>
            )}
          </p>
          <span
            className={
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 " +
              (reached ? "bg-peach" : "bg-white/20")
            }
          >
            <span
              className={reached ? "text-brand-dark" : "text-white"}
              style={{ fontSize: 12.5, fontWeight: 500 }}
            >
              {reached ? "Redeem" : "View"}
            </span>
            <ArrowRight
              size={12}
              className={reached ? "text-brand-dark" : "text-white"}
            />
          </span>
        </div>
      </Link>
    </div>
  );
}
