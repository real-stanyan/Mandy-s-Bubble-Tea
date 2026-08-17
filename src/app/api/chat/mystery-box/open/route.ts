import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { openMysteryBox } from "@/lib/mystery-box";

// The click on the mystery box. The draw happens HERE, server-side, at open
// time — the offer in the chat is just a closed box with no prize inside it
// yet, so nothing the client caches, replays, or edits can influence what
// comes out. The box is unlocked by a secret Instagram code; one box per
// (phone, code) is the table's unique index (a double-tap loses the race
// and gets "already-used").

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

  let code = "";
  try {
    const body = (await request.json()) as { code?: unknown };
    if (typeof body.code === "string") code = body.code;
  } catch {
    // no body → empty code → invalid-code below
  }

  const result = await openMysteryBox(
    phone,
    user.profile?.square_customer_id ?? null,
    code,
  );

  if (!result.opened) {
    return NextResponse.json(
      { ok: false, reason: result.reason },
      // already-used / invalid-code are facts, not failures — 200 so the
      // client renders the right state instead of an error toast.
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
