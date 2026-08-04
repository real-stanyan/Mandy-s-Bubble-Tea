import { getSupabaseAdmin } from "@/lib/supabase-server";
import { isMissingTableError } from "@/lib/postgrest-errors";
import { CAMPAIGNS } from "@/lib/loyalty-campaigns";
import { LoyaltyPushPanel, type Run } from "./panel";

export const dynamic = "force-dynamic";

export default async function AdminLoyaltyPushPage() {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("loyalty_push_runs")
    .select(
      "id,campaign,title_singular,cooldown_days,eligible_count,suppressed_count,targeted_count,accepted_count,errored_count,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(20);

  // Migrations are applied by hand in the Supabase dashboard (see
  // scripts/migrations/README.md), so the deploy can land before the table
  // exists. Say so instead of 500-ing on a missing relation.
  const needsMigration = isMissingTableError(error);

  const campaigns = Object.values(CAMPAIGNS).map((c) => ({
    id: c.id,
    label: c.label,
    description: c.description,
    defaultCooldownDays: c.defaultCooldownDays,
    defaultCopy: c.defaultCopy,
  }));

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Loyalty pushes</h1>
      <p className="text-sm text-gray-600 mb-6">
        Notify app customers about their star balance. Preview first — it shows
        exactly how many devices would be reached and what the message reads
        like.
      </p>
      {needsMigration ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <b>Setup needed.</b> Run{" "}
          <code>scripts/migrations/005_loyalty_push_campaigns.sql</code> in the
          Supabase SQL editor, then reload. Sending is disabled until then —
          without the tables there is no cooldown record, so a second click
          would re-notify everyone.
        </div>
      ) : (
        <LoyaltyPushPanel campaigns={campaigns} runs={(data ?? []) as Run[]} />
      )}
    </div>
  );
}
