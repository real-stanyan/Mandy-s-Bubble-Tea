import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { squareClient } from "@/lib/square";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { isWithinComplaintWindow, ownsOrder } from "@/lib/order-complaint";

function noStoreJson(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export type ComplaintStatusReason =
  | "eligible"
  | "not_completed"
  | "window_closed"
  | "already_reported";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  const auth = await getAuthedUser(request);
  if (!auth) {
    return noStoreJson(
      { ok: false, error: "NOT_AUTHENTICATED" },
      { status: 401 },
    );
  }

  let order;
  try {
    const response = await squareClient.orders.get({ orderId });
    order = response.order;
  } catch {
    return noStoreJson(
      { ok: false, error: "ORDER_NOT_FOUND" },
      { status: 404 },
    );
  }

  if (!order) {
    return noStoreJson(
      { ok: false, error: "ORDER_NOT_FOUND" },
      { status: 404 },
    );
  }

  const sessionCustomerId = auth.profile?.square_customer_id ?? null;
  if (!ownsOrder(sessionCustomerId, order.customerId ?? null)) {
    return noStoreJson(
      { ok: false, error: "NOT_OWN_ORDER" },
      { status: 403 },
    );
  }

  if (order.state !== "COMPLETED") {
    return noStoreJson({
      ok: true,
      reason: "not_completed" satisfies ComplaintStatusReason,
    });
  }

  if (!isWithinComplaintWindow(order.closedAt ?? null, new Date())) {
    return noStoreJson({
      ok: true,
      reason: "window_closed" satisfies ComplaintStatusReason,
    });
  }

  const admin = getSupabaseAdmin();
  const { data: existing, error: dbErr } = await admin
    .from("order_complaints")
    .select("created_at")
    .eq("order_id", orderId)
    .maybeSingle();

  if (dbErr) {
    console.error("[complaint-status] supabase query failed", dbErr);
    return noStoreJson(
      { ok: false, error: "SERVICE_ERROR" },
      { status: 503 },
    );
  }

  if (existing) {
    return noStoreJson({
      ok: true,
      reason: "already_reported" satisfies ComplaintStatusReason,
      alreadyReportedAt: existing.created_at,
    });
  }

  return noStoreJson({
    ok: true,
    reason: "eligible" satisfies ComplaintStatusReason,
  });
}
