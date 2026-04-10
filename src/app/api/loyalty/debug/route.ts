import { NextResponse } from "next/server";
import {
  getActiveProgram,
  invalidateLoyaltyProgramCache,
} from "@/lib/loyalty";
import { squareClient } from "@/lib/square";

// Diagnostic endpoint for the loyalty program. Dumps the raw Square
// program response alongside the tier id we would send to
// CreateLoyaltyReward, so we can verify the rewardTierId matches
// what Square actually has on file. Call with ?refresh=1 to bypass
// the in-process cache.
//
// Safe to keep in production — it only exposes data the seller
// already sees in their own Square Dashboard, and returns no
// customer PII.

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("refresh") === "1") {
    invalidateLoyaltyProgramCache();
  }

  try {
    const response = await squareClient.loyalty.programs.get({
      programId: "main",
    });
    const program = response.program;
    const resolved = await getActiveProgram();

    const tiers =
      program?.rewardTiers?.map((t) => ({
        id: t.id ?? null,
        points: t.points,
        name: t.name ?? null,
        pricingRuleReferenceObjectId:
          (t as { pricingRuleReference?: { objectId?: string } })
            .pricingRuleReference?.objectId ?? null,
      })) ?? [];

    return NextResponse.json({
      ok: true,
      program: {
        id: program?.id ?? null,
        status: program?.status ?? null,
        terminology: program?.terminology ?? null,
        rewardTiers: tiers,
      },
      resolvedForRedemption: {
        programId: resolved.programId,
        rewardTierId: resolved.rewardTierId,
        starsPerReward: resolved.starsPerReward,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
