import { NextResponse } from "next/server";
import { getAdminUserId } from "@/lib/admin-auth";
import {
  CAMPAIGNS,
  renderCopy,
  type CampaignCopy,
  type CampaignId,
} from "@/lib/loyalty-campaigns";
import { buildAudience } from "@/lib/loyalty-campaigns.server";

export const dynamic = "force-dynamic";
// Scanning every loyalty account pages through Square 200 at a time; a few
// thousand accounts takes well over the default budget.
export const maxDuration = 90;

type Body = {
  campaign?: string;
  cooldownDays?: number;
  copy?: CampaignCopy;
};

export async function POST(request: Request) {
  const userId = await getAdminUserId();
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const campaignId = body.campaign as CampaignId;
  if (!campaignId || !(campaignId in CAMPAIGNS)) {
    return NextResponse.json(
      { ok: false, error: "unknown campaign" },
      { status: 400 },
    );
  }
  const cooldownDays =
    typeof body.cooldownDays === "number" && body.cooldownDays >= 0
      ? Math.floor(body.cooldownDays)
      : CAMPAIGNS[campaignId].defaultCooldownDays;

  try {
    const audience = await buildAudience(campaignId, cooldownDays);
    const copy = body.copy ?? CAMPAIGNS[campaignId].defaultCopy;

    return NextResponse.json({
      ok: true,
      starsPerReward: audience.starsPerReward,
      eligiblePhones: audience.eligiblePhones,
      reachablePhones: audience.reachablePhones,
      suppressedPhones: audience.suppressedPhones,
      deviceCount: audience.recipients.length,
      // Deliberately never returns phone numbers or tokens — the preview
      // only needs counts and rendered copy, and this response is read in
      // the browser.
      breakdown: audience.breakdown.map((b) => ({
        ...b,
        preview: renderCopy(copy, b.n),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
