import { NextResponse } from "next/server";
import { verifyDeviceToken } from "@/lib/twilio";
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

  const { deviceToken } = (body ?? {}) as { deviceToken?: unknown };
  if (typeof deviceToken !== "string" || !deviceToken.trim()) {
    return NextResponse.json({ ok: true, valid: false });
  }

  // Verify HMAC signature — no database lookup needed.
  const e164 = verifyDeviceToken(deviceToken);
  if (!e164) {
    return NextResponse.json({ ok: true, valid: false });
  }

  // Token is valid — look up customer in Square.
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
        valid: true,
        customerId: existing.id,
        givenName: existing.givenName ?? null,
        familyName: existing.familyName ?? null,
        phoneE164: e164,
      });
    }

    // Token valid but customer not in Square.
    return NextResponse.json({
      ok: true,
      valid: true,
      phoneE164: e164,
      customerId: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 },
    );
  }
}
