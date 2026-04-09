import { NextResponse } from "next/server";
import {
  findOrCreateLoyaltyAccount,
  getActiveProgram,
} from "@/lib/loyalty";
import { normalizeAuPhone } from "@/lib/phone";

// Returns (or enrolls) the loyalty account for a given customer. Used
// by the account page (slice J) to show the stars balance and, later,
// by checkout to decide whether a reward can be redeemed.

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

  const { customerId, phone } = (body ?? {}) as {
    customerId?: unknown;
    phone?: unknown;
  };

  if (typeof customerId !== "string" || !customerId) {
    return NextResponse.json(
      { ok: false, error: "customerId is required" },
      { status: 400 },
    );
  }
  if (typeof phone !== "string" || !phone) {
    return NextResponse.json(
      { ok: false, error: "phone is required" },
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
    const [account, program] = await Promise.all([
      findOrCreateLoyaltyAccount(customerId, e164),
      getActiveProgram(),
    ]);

    return NextResponse.json({
      ok: true,
      accountId: account.accountId,
      balance: account.balance,
      lifetimePoints: account.lifetimePoints,
      starsPerReward: program.starsPerReward,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
