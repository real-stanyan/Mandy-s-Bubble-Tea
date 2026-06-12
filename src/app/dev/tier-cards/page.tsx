import { notFound } from "next/navigation";
import { LoyaltyCard } from "@/components/account/LoyaltyCard";

/** Dev-only gallery of the three tier card faces (404s in production). */
export default function TierCardsPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto max-w-md space-y-6 py-8">
      <LoyaltyCard balance={3} starsPerReward={9} lifetimePoints={5} />
      <LoyaltyCard balance={5} starsPerReward={9} lifetimePoints={40} />
      <LoyaltyCard
        balance={7}
        starsPerReward={9}
        lifetimePoints={90}
        freeToppingsRemaining={10}
      />
    </main>
  );
}
