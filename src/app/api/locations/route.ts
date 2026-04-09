import { NextResponse } from "next/server";
import { squareClient } from "@/lib/square";
import { serializeSquareResponse } from "@/lib/utils";

// Temporary smoke-test. Locations always has at least one entry for a
// valid Square account, so this confirms the token works even when the
// catalog is empty.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await squareClient.locations.list();
    return NextResponse.json({
      ok: true,
      locations: serializeSquareResponse(res.locations ?? []),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
