import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { openMysteryBox } from "@/lib/mystery-box";

// The click on the mystery box. The draw happens HERE, server-side, at open
// time — the offer in the chat is just a closed box with no prize inside it
// yet, so nothing the client caches, replays, or edits can influence what
// comes out. One box per phone per Brisbane day, enforced by the table's
// unique index (a double-tap loses the race and gets "already-today").

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getAuthedUser(request);
  const phone = user?.profile?.phone_e164;
  if (!user || !phone) {
    return NextResponse.json(
      { ok: false, error: "Sign in first", signIn: true },
      { status: 401 },
    );
  }

  const result = await openMysteryBox(
    phone,
    user.profile?.square_customer_id ?? null,
  );

  if (!result.opened) {
    return NextResponse.json(
      { ok: false, reason: result.reason },
      // already-today is a fact, not a failure — 200 so the client renders
      // the "come back tomorrow" state instead of an error toast.
      { status: result.reason === "unavailable" ? 503 : 200 },
    );
  }

  return NextResponse.json({
    ok: true,
    couponId: result.couponId,
    prize: result.prize,
    label: result.label,
    expiresAt: result.expiresAt,
  });
}
