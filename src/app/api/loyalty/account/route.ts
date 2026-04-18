import { NextResponse } from "next/server";
import {
  findLoyaltyAccountByPhone,
  findOrCreateLoyaltyAccount,
  getActiveProgram,
} from "@/lib/loyalty";
import { getAuthedUser } from "@/lib/auth";

// Returns (or enrolls) the loyalty account for the signed-in user.
// Phone + customerId come from the Supabase profile — never from the
// request body. Signed-out callers get `{ account: null }` so the UI
// can still render the program rules.

export const dynamic = "force-dynamic";

// GET — read-only lookup. Never creates an account.
export async function GET(request: Request) {
  const user = await getAuthedUser(request);
  const program = await getActiveProgram();
  const phone = user?.profile?.phone_e164;
  if (!phone) {
    return NextResponse.json({
      ok: true,
      account: null,
      starsPerReward: program.starsPerReward,
    });
  }

  try {
    const account = await findLoyaltyAccountByPhone(phone);
    return NextResponse.json({
      ok: true,
      account: account
        ? {
            id: account.accountId,
            balance: account.balance,
            lifetimePoints: account.lifetimePoints,
          }
        : null,
      starsPerReward: program.starsPerReward,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

// POST — find or create. Used by checkout to ensure the account
// exists before attaching a reward.
export async function POST(request: Request) {
  const user = await getAuthedUser(request);
  if (!user?.profile?.square_customer_id || !user.profile.phone_e164) {
    return NextResponse.json(
      { ok: false, error: "Sign in to enroll in loyalty" },
      { status: 401 },
    );
  }

  try {
    const [account, program] = await Promise.all([
      findOrCreateLoyaltyAccount(
        user.profile.square_customer_id,
        user.profile.phone_e164,
      ),
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
