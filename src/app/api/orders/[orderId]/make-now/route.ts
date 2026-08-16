import { NextResponse } from "next/server";
import { squareClient } from "@/lib/square";
import { getAuthedUser } from "@/lib/auth";
import { ownsOrder } from "@/lib/order-complaint";
import { getSupabaseAdmin } from "@/lib/supabase-server";

// "I'm here — make it now." A scheduled-pickup customer who arrives early
// taps this to release their held cup-sticker immediately instead of
// waiting out print_due_at. The whole mechanism is one UPDATE: pull
// print_due_at to now on the still-pending job, and the printer-client's
// next poll (≤8s) prints it. No second print path, same idempotent queue.
//
// Outcomes are honest, not optimistic: `released` only when a held pending
// job was actually advanced; `already-printing` when the sticker is out
// (or was never held) so the UI can say "it's already being made".

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
): Promise<NextResponse> {
  const { orderId } = await params;

  const user = await getAuthedUser(request);
  if (!user?.profile?.square_customer_id) {
    return NextResponse.json(
      { ok: false, error: "Sign in first" },
      { status: 401 },
    );
  }

  // Ownership: only the customer the order belongs to may release it.
  // Square is the authority on that linkage, same as the complaint route.
  let orderCustomerId: string | null;
  try {
    const { order } = await squareClient.orders.get({ orderId });
    orderCustomerId = order?.customerId ?? null;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Order not found" },
      { status: 404 },
    );
  }
  if (!ownsOrder(user.profile.square_customer_id, orderCustomerId)) {
    return NextResponse.json(
      { ok: false, error: "Not your order" },
      { status: 403 },
    );
  }

  // Dev guard mirror: enqueuePrintJob never inserted a row in development
  // (it would print a real sticker at the store — dev and prod share one
  // Supabase), so there is nothing to release. Simulate success so the
  // local flow is demonstrable end-to-end.
  if (process.env.NODE_ENV === "development") {
    console.log(`[make-now dev] simulated release for order ${orderId}`);
    return NextResponse.json({ ok: true, outcome: "released", simulated: true });
  }

  // The release: only a job that is still pending AND still held moves.
  // A printed/printing/failed job, or one whose hold already lapsed, is
  // left alone — filtering on the held state is what makes a double-tap
  // (or a tap racing the printer's claim) harmless.
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("print_jobs")
    .update({ print_due_at: new Date().toISOString() })
    .eq("square_order_id", orderId)
    .eq("status", "pending")
    .gt("print_due_at", new Date().toISOString())
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[make-now] release failed:", error.message);
    return NextResponse.json(
      { ok: false, error: "Could not reach the print queue" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    outcome: data ? "released" : "already-printing",
  });
}
