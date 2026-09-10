import { NextResponse } from "next/server";
import { hasAtLeast, currentRole } from "@/lib/staff/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { isMissingTableError } from "@/lib/postgrest-errors";
import {
  CAMPAIGNS,
  isCampaignId,
  isQuietHours,
  normaliseSettings,
  validCopy,
  type CampaignSettings,
  type Copy,
} from "@/lib/push-center/campaigns";
import { buildAudience } from "@/lib/push-center/audience.server";
import { sendRun } from "@/lib/push-center/send.server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = {
  campaign?: string;
  settings?: Partial<CampaignSettings>;
  copy?: Partial<Copy>;
  /** Devices the owner saw in the preview they are approving. */
  expectedDeviceCount?: number;
  /** Specials: the prices the preview was drafted from. */
  fingerprint?: string | null;
  /** The page showed the quiet-hours warning and the owner ticked "send anyway". */
  overrideQuietHours?: boolean;
};

/** Tokens register at a dozen a day, so a broadcast may legitimately move a little. */
function driftTolerance(expected: number): number {
  return Math.max(3, Math.ceil(expected * 0.02));
}

async function ledgerReady(): Promise<boolean> {
  const { error } = await getSupabaseAdmin().from("push_run_recipients").select("id").limit(1);
  if (!error) return true;
  if (isMissingTableError(error)) return false;
  throw new Error(`push_run_recipients probe: ${error.message}`);
}

export async function POST(request: Request) {
  if (!(await hasAtLeast("owner"))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as Body;
  if (!isCampaignId(body.campaign)) {
    return NextResponse.json({ ok: false, error: "unknown campaign" }, { status: 400 });
  }
  const campaign = body.campaign;
  const copy = body.copy;
  if (!validCopy(copy)) {
    return NextResponse.json({ ok: false, error: "Title and body are required (120 / 300 characters max)." }, { status: 400 });
  }
  const settings = normaliseSettings(campaign, body.settings);
  const now = new Date();

  if (isQuietHours(now) && body.overrideQuietHours !== true) {
    return NextResponse.json(
      { ok: false, code: "quiet_hours", error: "It's outside 10:30–20:30 shop time. Tick “send anyway” if you mean it." },
      { status: 409 },
    );
  }

  try {
    // No ledger means no cooldown and no cap: a second click would notify
    // everyone again. Refuse before anything goes out.
    if (!(await ledgerReady())) {
      return NextResponse.json(
        { ok: false, error: "Push tables are missing — apply supabase/migrations/2026-09-10-push-center.sql first." },
        { status: 503 },
      );
    }

    // Rebuilt server-side rather than trusting a client list: the browser
    // never gets to name who is pushed.
    const audience = await buildAudience(campaign, settings, copy, now);

    if (audience.fingerprint && body.fingerprint !== audience.fingerprint) {
      return NextResponse.json(
        { ok: false, code: "prices_changed", error: "The specials shelf or its prices changed since the preview. Preview again." },
        { status: 409 },
      );
    }
    if (audience.recipients.length === 0) {
      return NextResponse.json({ ok: true, sent: false, reason: "nobody left after cooldown and caps", funnel: audience.funnel });
    }
    if (
      typeof body.expectedDeviceCount === "number" &&
      Math.abs(body.expectedDeviceCount - audience.recipients.length) > driftTolerance(body.expectedDeviceCount)
    ) {
      return NextResponse.json(
        {
          ok: false,
          code: "drift",
          error: `The audience moved since the preview (${body.expectedDeviceCount} → ${audience.recipients.length} devices). Preview again.`,
        },
        { status: 409 },
      );
    }

    const result = await sendRun({
      campaign,
      copy,
      url: CAMPAIGNS[campaign].url,
      settings,
      audience,
      createdBy: (await currentRole()) ?? "owner",
    });
    return NextResponse.json({ ok: true, sent: true, ...result, funnel: audience.funnel });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
