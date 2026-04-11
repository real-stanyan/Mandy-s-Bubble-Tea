import { NextResponse } from "next/server";
import { squareClient, ensureReferenceId } from "@/lib/square";
import { normalizeAuPhone } from "@/lib/phone";

// Phone-only lookup, no create. Used by the account page so someone
// who types a phone number that isn't in Square doesn't silently get a
// new empty customer record. Separate from /api/customer (which is
// lookup-or-create, and is called during checkout where we already
// know the visitor intends to transact).

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
      { ok: false, error: "Phone number could not be parsed" },
      { status: 400 },
    );
  }

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
    if (!existing?.id) {
      return NextResponse.json({ ok: true, found: false });
    }

    await ensureReferenceId(existing.id, existing.referenceId, e164);

    return NextResponse.json({
      ok: true,
      found: true,
      customerId: existing.id,
      givenName: existing.givenName ?? null,
      familyName: existing.familyName ?? null,
      phoneE164: e164,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
