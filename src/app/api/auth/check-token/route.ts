import { NextResponse } from "next/server";
import { verifyDeviceToken } from "@/lib/twilio";
import {
  squareClient,
  ensureReferenceId,
  findCustomerByPhone,
} from "@/lib/square";

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
    let existing = await findCustomerByPhone(e164);

    // Phone lookup missed. This happens when the merchant edits the
    // customer's phone in Square Dashboard after signup — the device
    // token still validates (it's HMAC of the original phone) but the
    // current phoneNumber field no longer matches. Fall back to a
    // referenceId search: ensureReferenceId has been seeding the
    // customer's reference_id with the signup phone on every login, so
    // it doubles as a stable identity pointer that survives phone edits.
    if (!existing?.id) {
      try {
        const byRef = await squareClient.customers.search({
          limit: BigInt(1),
          query: { filter: { referenceId: { exact: e164 } } },
        });
        existing = byRef.customers?.[0] ?? null;
      } catch {
        // Non-fatal — fall through to the "no customer" response.
      }
    }

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
