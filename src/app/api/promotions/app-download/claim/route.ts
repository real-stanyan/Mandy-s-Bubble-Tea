import { NextResponse } from "next/server";
import { claimAppDownloadDiscount } from "@/lib/app-download-discount";
import { normalizeAuPhone } from "@/lib/phone";

// Mint a one-order 20%-off ticket for a phone number entered in the web
// "download the app" popup. NO auth — the claimer hasn't installed or signed
// into the app yet; the phone is the only identity they can offer. Idempotent:
// a duplicate phone returns { alreadyClaimed: true } and changes nothing.
// Honor system — the phone is not OTP-verified. The per-phone primary key is
// the whole defence: claiming a stranger's phone only grants the discount to
// that phone's real owner (who alone can sign into the app and redeem it).
//
// TODO(follow-up): add IP rate-limiting to cap DB-bloat from scripted claims;
// no infra helper exists in this repo yet. Grief is already bounded by the
// per-phone unique constraint — this is a storage concern, not a fraud one.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const raw = (body as { phone?: unknown } | null)?.phone;
  if (typeof raw !== "string") {
    return NextResponse.json(
      { ok: false, error: "phone required" },
      { status: 400 },
    );
  }

  const phone = normalizeAuPhone(raw);
  if (!phone) {
    return NextResponse.json(
      { ok: false, error: "invalid phone" },
      { status: 400 },
    );
  }

  const result = await claimAppDownloadDiscount(phone);
  return NextResponse.json({ ok: true, alreadyClaimed: result.alreadyClaimed });
}
