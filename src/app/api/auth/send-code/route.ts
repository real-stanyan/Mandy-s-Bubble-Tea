import { NextResponse } from "next/server";
import { normalizeAuPhone } from "@/lib/phone";
import { sendVerification } from "@/lib/twilio";

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

  const { phone } = (body ?? {}) as { phone?: unknown };
  if (typeof phone !== "string" || !phone.trim()) {
    return NextResponse.json(
      { ok: false, error: "Phone is required" },
      { status: 400 },
    );
  }

  const e164 = normalizeAuPhone(phone);
  if (!e164) {
    return NextResponse.json(
      { ok: false, error: "Invalid phone number" },
      { status: 400 },
    );
  }

  try {
    await sendVerification(e164);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Twilio Verify has built-in rate limiting.
    if (message.includes("Max send attempts reached")) {
      return NextResponse.json(
        { ok: false, error: "Too many attempts, please try again later" },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { ok: false, error: `SMS send failed: ${message}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
