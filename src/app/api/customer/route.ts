import { NextResponse } from "next/server";
import { squareClient, ensureReferenceId } from "@/lib/square";
import { normalizeAuPhone } from "@/lib/phone";

// Phone-based customer lookup. Given {name, phone}, finds an existing
// Square customer by exact phone match, or creates a new one.
// Used by /checkout before placing an order, and is the basis for the
// account page (slice J) and loyalty (slice I).

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

  const { name, firstName, lastName, phone } = (body ?? {}) as {
    name?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    phone?: unknown;
  };

  // Support both {firstName, lastName} and legacy {name} format.
  let givenName: string;
  let familyName: string | undefined;

  if (typeof firstName === "string" && firstName.trim()) {
    givenName = firstName.trim();
    familyName = typeof lastName === "string" && lastName.trim()
      ? lastName.trim()
      : undefined;
  } else if (typeof name === "string" && name.trim()) {
    const parts = name.trim().split(/\s+/);
    givenName = parts[0];
    familyName = parts.slice(1).join(" ") || undefined;
  } else {
    return NextResponse.json(
      { ok: false, error: "Name is required" },
      { status: 400 },
    );
  }

  if (typeof phone !== "string") {
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
    // Exact phone lookup first.
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
        customerId: existing.id,
        phoneE164: e164,
        created: false,
      });
    }

    // Not found — create a new customer with referenceId set up-front.
    const created = await squareClient.customers.create({
      givenName,
      familyName,
      phoneNumber: e164,
      referenceId: e164,
    });

    const newId = created.customer?.id;
    if (!newId) {
      return NextResponse.json(
        { ok: false, error: "Square did not return a customer id" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      customerId: newId,
      phoneE164: e164,
      created: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
