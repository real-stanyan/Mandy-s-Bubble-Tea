import { NextResponse } from "next/server";
import { normalizeAuPhone } from "@/lib/phone";
import { redis } from "@/lib/redis";
import { squareClient, ensureReferenceId } from "@/lib/square";

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

  const { phone, code } = (body ?? {}) as {
    phone?: unknown;
    code?: unknown;
  };

  if (typeof phone !== "string" || !phone.trim()) {
    return NextResponse.json(
      { ok: false, error: "Phone is required" },
      { status: 400 },
    );
  }
  if (typeof code !== "string" || !code.trim()) {
    return NextResponse.json(
      { ok: false, error: "Code is required" },
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

  // Look up stored OTP.
  const storedCode = await redis.get<string>(`otp:${e164}`);
  if (!storedCode) {
    return NextResponse.json(
      { ok: false, error: "Code expired, please request a new one" },
      { status: 410 },
    );
  }
  if (storedCode !== code.trim()) {
    return NextResponse.json(
      { ok: false, error: "Invalid code" },
      { status: 401 },
    );
  }

  // Code matches — delete it so it can't be reused.
  await redis.del(`otp:${e164}`);

  // Generate device token for trusted-device flow.
  const deviceToken = crypto.randomUUID();
  await redis.set(`device:${deviceToken}`, e164);

  // Look up customer in Square.
  try {
    const search = await squareClient.customers.search({
      limit: BigInt(1),
      query: {
        filter: {
          phoneNumber: { exact: e164 },
        },
      },
    });

    const existing = search.customers?.[0];
    if (existing?.id) {
      await ensureReferenceId(existing.id, existing.referenceId, e164);
      return NextResponse.json({
        ok: true,
        deviceToken,
        found: true,
        customerId: existing.id,
        givenName: existing.givenName ?? null,
        familyName: existing.familyName ?? null,
        phoneE164: e164,
      });
    }

    // Phone verified but no Square customer yet — new user.
    return NextResponse.json({
      ok: true,
      deviceToken,
      found: false,
      phoneE164: e164,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 },
    );
  }
}
