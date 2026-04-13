import { NextResponse } from "next/server";
import { normalizeAuPhone } from "@/lib/phone";
import { redis } from "@/lib/redis";
import { sendOtp } from "@/lib/twilio";

const OTP_TTL = 300; // 5 minutes
const RATE_LIMIT = 3; // max sends per window
const RATE_TTL = 300; // 5-minute window

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

  // Rate limit: max 3 sends per 5-minute window per phone.
  const rateKey = `otp:rate:${e164}`;
  const currentCount = await redis.incr(rateKey);
  if (currentCount === 1) {
    await redis.expire(rateKey, RATE_TTL);
  }
  if (currentCount > RATE_LIMIT) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts, please try again later" },
      { status: 429 },
    );
  }

  // Generate 6-digit code.
  const code = String(Math.floor(100000 + Math.random() * 900000));

  // Store in Redis with TTL.
  await redis.set(`otp:${e164}`, code, { ex: OTP_TTL });

  // Send SMS via Twilio.
  try {
    await sendOtp(e164, code);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `SMS send failed: ${message}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
