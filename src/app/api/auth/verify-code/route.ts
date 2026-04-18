import { NextResponse } from "next/server";
import { normalizeAuPhone } from "@/lib/phone";
import { checkVerification, createDeviceToken } from "@/lib/twilio";
import { ensureReferenceId, findCustomerByPhone } from "@/lib/square";

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

  // Verify via Twilio Verify Service.
  let approved: boolean;
  try {
    approved = await checkVerification(e164, code.trim());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found") || message.includes("expired")) {
      return NextResponse.json(
        { ok: false, error: "Code expired, please request a new one" },
        { status: 410 },
      );
    }
    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 },
    );
  }

  if (!approved) {
    return NextResponse.json(
      { ok: false, error: "Invalid code" },
      { status: 401 },
    );
  }

  // Code approved — create signed device token (no storage needed).
  const deviceToken = createDeviceToken(e164);

  // Look up customer in Square.
  try {
    const existing = await findCustomerByPhone(e164);
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
