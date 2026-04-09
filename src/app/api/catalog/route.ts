import { NextResponse } from "next/server";
import { squareClient } from "@/lib/square";
import { serializeSquareResponse } from "@/lib/utils";

// Smoke-test handler for the Square connection.
// Lists catalog ITEMs and returns the first few so we can verify the
// token, environment, and BigInt serialization all work end-to-end.
// Will be replaced by the real catalog endpoint during feature work.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const page = await squareClient.catalog.list({ types: "ITEM" });

    const items = [];
    for await (const item of page) {
      items.push(item);
      if (items.length >= 5) break;
    }

    return NextResponse.json({
      ok: true,
      count: items.length,
      items: serializeSquareResponse(items),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
