import { NextResponse } from "next/server";
import { squareClient } from "@/lib/square";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  try {
    const response = await squareClient.orders.get({ orderId });
    const state = response.order?.fulfillments?.[0]?.state ?? null;
    return NextResponse.json(
      { ok: true, state },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
