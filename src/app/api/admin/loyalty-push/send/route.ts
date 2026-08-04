import { NextResponse } from "next/server";
import { getAdminUserId } from "@/lib/admin-auth";
import { CAMPAIGNS, type CampaignCopy, type CampaignId } from "@/lib/loyalty-campaigns";
import {
  buildAudience,
  campaignTablesReady,
  recordRun,
  sendCampaign,
} from "@/lib/loyalty-campaigns.server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

type Body = {
  campaign?: string;
  cooldownDays?: number;
  copy?: CampaignCopy;
  /**
   * Device count the admin saw in the preview they clicked send on. If the
   * audience moved underneath them (a customer redeemed, someone crossed
   * the threshold) by more than a hair, we refuse and make them re-preview
   * rather than silently pushing a different-sized list than they approved.
   */
  expectedDeviceCount?: number;
};

const DRIFT_TOLERANCE = 3;

function validCopy(copy: CampaignCopy | undefined): copy is CampaignCopy {
  if (!copy) return false;
  return (
    [copy.titleSingular, copy.bodySingular, copy.titlePlural, copy.bodyPlural].every(
      (s) => typeof s === "string" && s.trim().length > 0,
    ) &&
    [copy.titleSingular, copy.titlePlural].every((s) => s.length <= 120) &&
    [copy.bodySingular, copy.bodyPlural].every((s) => s.length <= 300)
  );
}

export async function POST(request: Request) {
  const userId = await getAdminUserId();
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const campaignId = body.campaign as CampaignId;
  if (!campaignId || !(campaignId in CAMPAIGNS)) {
    return NextResponse.json({ ok: false, error: "unknown campaign" }, { status: 400 });
  }

  const copy = body.copy ?? CAMPAIGNS[campaignId].defaultCopy;
  if (!validCopy(copy)) {
    return NextResponse.json(
      { ok: false, error: "message text is empty or too long" },
      { status: 400 },
    );
  }

  const cooldownDays =
    typeof body.cooldownDays === "number" && body.cooldownDays >= 0
      ? Math.floor(body.cooldownDays)
      : CAMPAIGNS[campaignId].defaultCooldownDays;

  try {
    // No recipients table means no cooldown record, which means a second
    // click re-notifies everyone. Refuse before anything is sent — the admin
    // page's setup banner is a hint, this is the gate.
    if (!(await campaignTablesReady())) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Loyalty push tables are missing. Run scripts/migrations/005_loyalty_push_campaigns.sql in the Supabase SQL editor first — without them there is no cooldown record.",
        },
        { status: 503 },
      );
    }

    // Rebuild rather than trusting a client-supplied recipient list: the
    // browser must never be able to name who gets pushed.
    const audience = await buildAudience(campaignId, cooldownDays);

    if (audience.recipients.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: false,
        reason: "no recipients after cooldown",
        eligiblePhones: audience.eligiblePhones,
        suppressedPhones: audience.suppressedPhones,
      });
    }

    if (
      typeof body.expectedDeviceCount === "number" &&
      Math.abs(body.expectedDeviceCount - audience.recipients.length) > DRIFT_TOLERANCE
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: `Audience changed since preview (${body.expectedDeviceCount} → ${audience.recipients.length}). Preview again before sending.`,
        },
        { status: 409 },
      );
    }

    const result = await sendCampaign(campaignId, copy, audience.recipients);
    const runId = await recordRun({
      campaign: campaignId,
      copy,
      cooldownDays,
      audience,
      recipients: audience.recipients,
      result,
      createdBy: userId,
    });

    return NextResponse.json({
      ok: true,
      sent: true,
      runId,
      targeted: audience.recipients.length,
      accepted: result.accepted,
      errored: result.errored,
      errors: result.errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
