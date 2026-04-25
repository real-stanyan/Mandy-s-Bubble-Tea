import { NextResponse } from "next/server";
import { squareClient } from "@/lib/square";
import { getDelivery } from "@/lib/uber-direct";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  let deliveryId: string | undefined;
  try {
    const response = await squareClient.orders.get({ orderId });
    deliveryId = response.order?.metadata?.uber_delivery_id ?? undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  if (!deliveryId) {
    return NextResponse.json(
      { ok: false, error: "no delivery id" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const detail = await getDelivery(deliveryId);
    return NextResponse.json(
      { ok: true, ...detail },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
