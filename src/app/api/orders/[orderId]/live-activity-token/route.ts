import { NextResponse } from "next/server";
import { squareClient } from "@/lib/square";
import { getAuthedUser } from "@/lib/auth";
import { ownsOrder } from "@/lib/order-complaint";
import { upsertLiveActivityToken } from "@/lib/live-activity";
import { isValidActivityToken } from "@/lib/live-activity-payload";

// The iOS app starts a Live Activity when an order is placed and uploads
// the ActivityKit push token here so the server can push content-state
// updates through APNs (see src/lib/live-activity.ts). ActivityKit can
// rotate the token mid-activity — the app re-POSTs and we upsert.
//
// Ownership: only the authenticated order owner may attach a token, same
// gate as the tracking payload in /api/orders/[orderId]/status — the
// Live Activity later carries the driver's live GPS, which is PII.

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  const user = await getAuthedUser(request);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { activityToken?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  if (!isValidActivityToken(body.activityToken)) {
    return NextResponse.json(
      { ok: false, error: "Invalid activityToken" },
      { status: 400 },
    );
  }

  // Ownership check against the Square order — mirrors the tracking gate in
  // /api/orders/[orderId]/status.
  let orderCustomerId: string | null = null;
  try {
    const response = await squareClient.orders.get({ orderId });
    orderCustomerId = response.order?.customerId ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[live-activity] token upload orders.get ${orderId} failed: ${message}`);
    return NextResponse.json(
      { ok: false, error: "Order not found" },
      { status: 404 },
    );
  }
  if (!ownsOrder(user.profile?.square_customer_id ?? null, orderCustomerId)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    await upsertLiveActivityToken(orderId, body.activityToken);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[live-activity] token upsert failed order=${orderId} user=${user.userId}: ${message}`,
    );
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
