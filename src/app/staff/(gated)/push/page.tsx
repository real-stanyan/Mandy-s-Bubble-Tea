import { notFound } from "next/navigation";
import { hasAtLeast } from "@/lib/staff/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { isMissingTableError } from "@/lib/postgrest-errors";
import { CAMPAIGNS, CAMPAIGN_IDS } from "@/lib/push-center/campaigns";
import { stateSummary } from "@/lib/push-center/state-store";
import { PushClient, type CampaignOption, type Run } from "./push-client";

export const dynamic = "force-dynamic";

export default async function StaffPushPage() {
  // Owner only: this is the shop talking to every customer's phone, and a
  // staff member who is not the owner has no business knowing it exists.
  if (!(await hasAtLeast("owner"))) notFound();

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("push_runs")
    .select(
      "id,campaign,title,targeted_count,accepted_count,errored_count,delivered_count,failed_count,receipts_checked_at,cooldown_count,capped_count,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(20);
  // The migration is applied by hand (ADR-0004), so the deploy can land
  // before the tables exist. Say so instead of 500-ing.
  const needsMigration = isMissingTableError(error);
  const state = await stateSummary(admin);

  const campaigns: CampaignOption[] = CAMPAIGN_IDS.map((id) => {
    const c = CAMPAIGNS[id];
    return {
      id,
      label: c.label,
      description: c.description,
      url: c.url,
      defaultCopy: c.defaultCopy,
      defaultSettings: c.defaultSettings,
      placeholders: c.placeholders,
    };
  });

  return (
    <PushClient
      campaigns={campaigns}
      runs={needsMigration ? [] : ((data ?? []) as Run[])}
      state={state}
      needsMigration={needsMigration}
    />
  );
}
