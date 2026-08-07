import { NextResponse } from "next/server";
import { getAdminUserId } from "@/lib/admin-auth";
import { getAllDevicePushTokens } from "@/lib/push-tokens";
import { sendExpoPush } from "@/lib/push";
import {
  claimTastingPromoPush,
  getTastingPromoByKey,
  releaseTastingPromoPush,
  tastingPromoCopy,
} from "@/lib/tasting-promo";

// Announce a tasting promo to every app device, once.
//
// The money in the notification is read from the promo row, NOT from the
// request body: the point of the push is to promise a price, and the only
// price that can be honoured is the one the pricing engine will read back out
// of the same row. A body that disagrees is rejected rather than quietly
// announcing a number checkout won't match.
//
// Double-send is the failure that matters (there is no per-recipient cooldown
// table for this promo), so the send is gated on claiming `pushed_at` — a
// conditional update that exactly one caller can win. A send that then fails
// outright releases the claim so it can be retried.

export const dynamic = "force-dynamic";
export const maxDuration = 90;

type Body = {
  promoKey?: string;
  productName?: string;
  tastingPriceCents?: number;
  title?: string;
  body?: string;
  /** Re-announce a promo that was already pushed (deliberate second wave). */
  force?: boolean;
};

export async function POST(request: Request) {
  const userId = await getAdminUserId();
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const promoKey = typeof body.promoKey === "string" ? body.promoKey.trim() : "";
  if (!promoKey) {
    return NextResponse.json(
      { ok: false, error: "promoKey is required" },
      { status: 400 },
    );
  }

  try {
    const promo = await getTastingPromoByKey(promoKey);
    if (!promo) {
      return NextResponse.json(
        {
          ok: false,
          error: `No tasting_promos row for "${promoKey}". Insert the promo before announcing it.`,
        },
        { status: 404 },
      );
    }

    // The body's copy of the offer is treated as the caller's assertion about
    // what they think they're announcing — a mismatch means the row was edited
    // (or the wrong key was pasted), and sending anyway would promise a price
    // checkout will not give.
    if (
      typeof body.productName === "string" &&
      body.productName.trim() &&
      body.productName.trim() !== promo.productName
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: `productName mismatch: row says "${promo.productName}".`,
        },
        { status: 409 },
      );
    }
    if (
      typeof body.tastingPriceCents === "number" &&
      Math.floor(body.tastingPriceCents) !== promo.tastingPriceCents
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: `tastingPriceCents mismatch: row says ${promo.tastingPriceCents}.`,
        },
        { status: 409 },
      );
    }

    const now = new Date();
    if (!promo.active || new Date(promo.endsAt) <= now) {
      return NextResponse.json(
        { ok: false, error: "Promo window is closed — nothing to announce." },
        { status: 409 },
      );
    }

    if (promo.pushedAt && !body.force) {
      return NextResponse.json(
        {
          ok: false,
          error: `Already announced at ${promo.pushedAt}. Pass force:true to send a second wave.`,
        },
        { status: 409 },
      );
    }

    // Claim first, send second: two admins clicking at once must not both push.
    // force skips the claim (the row is already stamped) — a deliberate resend
    // is the one case where "already pushed" is not a reason to stop.
    if (!body.force && !(await claimTastingPromoPush(promoKey))) {
      return NextResponse.json(
        { ok: false, error: "Another send is already in flight." },
        { status: 409 },
      );
    }

    const copy = tastingPromoCopy(promo, now);
    const title = typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 120)
      : copy.title;
    const message = typeof body.body === "string" && body.body.trim()
      ? body.body.trim().slice(0, 300)
      : copy.body;

    let tokens: string[];
    try {
      tokens = await getAllDevicePushTokens();
    } catch (audienceError) {
      if (!body.force) await releaseTastingPromoPush(promoKey);
      throw audienceError;
    }

    if (tokens.length === 0) {
      if (!body.force) await releaseTastingPromoPush(promoKey);
      return NextResponse.json({
        ok: true,
        sent: false,
        reason: "no registered devices",
        targeted: 0,
      });
    }

    const accepted = await sendExpoPush(tokens, {
      title,
      body: message,
      // Deep link: the app routes `url` to its menu screen (same contract the
      // loyalty campaigns use).
      data: { type: "tasting-promo", url: "/menu", promoKey },
    });

    return NextResponse.json({
      ok: true,
      sent: true,
      promoKey,
      title,
      body: message,
      targeted: tokens.length,
      accepted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
