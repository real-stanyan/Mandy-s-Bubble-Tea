import { NextResponse } from "next/server";
import { squareClient } from "@/lib/square";
import { estimateOrderWaitMinutes, formatWaitRange } from "@/lib/order-wait";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  try {
    const response = await squareClient.orders.get({ orderId });
    const order = response.order;
    if (!order) {
      return NextResponse.json(
        { ok: false, error: "Order not found" },
        { status: 404 },
      );
    }
    const minutes = await estimateOrderWaitMinutes(order);
    const text = formatWaitRange(minutes);
    return NextResponse.json(
      { ok: true, minutes, text },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
