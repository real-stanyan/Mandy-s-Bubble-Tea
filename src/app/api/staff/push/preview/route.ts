import { NextResponse } from "next/server";
import { hasAtLeast } from "@/lib/staff/auth";
import {
  CAMPAIGNS,
  isCampaignId,
  isQuietHours,
  normaliseSettings,
  type CampaignSettings,
  type Copy,
} from "@/lib/push-center/campaigns";
import { buildAudience } from "@/lib/push-center/audience.server";

export const dynamic = "force-dynamic";
// The star-balance scan pages the loyalty program 200 at a time, and the
// state table is a few thousand rows; well past the default budget.
export const maxDuration = 120;

type Body = { campaign?: string; settings?: Partial<CampaignSettings>; copy?: Partial<Copy> };

export async function POST(request: Request) {
  // Owner, not staff: this is the shop talking to every customer's phone.
  if (!(await hasAtLeast("owner"))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as Body;
  if (!isCampaignId(body.campaign)) {
    return NextResponse.json({ ok: false, error: "unknown campaign" }, { status: 400 });
  }
  const campaign = body.campaign;
  const settings = normaliseSettings(campaign, body.settings);
  const copy: Copy = {
    title: typeof body.copy?.title === "string" ? body.copy.title : CAMPAIGNS[campaign].defaultCopy.title,
    body: typeof body.copy?.body === "string" ? body.copy.body : CAMPAIGNS[campaign].defaultCopy.body,
  };

  try {
    const now = new Date();
    const audience = await buildAudience(campaign, settings, copy, now);
    // Counts and rendered text only — never a token or a phone number; this
    // response is read in the browser.
    return NextResponse.json({
      ok: true,
      campaign,
      settings,
      funnel: audience.funnel,
      samples: audience.samples,
      context: audience.context,
      fingerprint: audience.fingerprint,
      quietHours: isQuietHours(now),
      now: now.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
