import "server-only";
import type { Order } from "square";
import { getSupabaseAdmin } from "../supabase-server";

/**
 * Safety net for the payment route's post-response cup-label enqueue dying
 * before it writes any rows (OL826 2026-06-06: the lambda was frozen right
 * after the response went out, so the fire-and-forget enqueue never ran —
 * and the webhook, seeing the payment route's print_jobs claim as a
 * conflict, skipped its own enqueue. Zero labels printed, zero errors).
 *
 * Called from the webhook's print_jobs-conflict branch: if the order has a
 * print_jobs claim but no cup_label_jobs rows, re-enqueue with the webhook's
 * default mode. If the payment route's enqueue is merely slow rather than
 * dead, the race is benign — its authoritative user-choice rows overwrite
 * these defaults via the enqueue upsert semantics.
 *
 * Returns true when a backfill enqueue ran.
 */
export async function backfillCupLabelJobsIfMissing(args: {
  order: Order;
  mode: "pos" | "web";
}): Promise<boolean> {
  const orderId = args.order.id;
  if (!orderId) return false;
  const sb = getSupabaseAdmin();

  const { count, error: countErr } = await sb
    .from("cup_label_jobs")
    .select("id", { count: "exact", head: true })
    .eq("square_order_id", orderId);
  if (countErr) throw new Error(`backfill count failed: ${countErr.message}`);
  if ((count ?? 0) > 0) return false;

  const { data, error } = await sb
    .from("print_jobs")
    .select("sticker_number")
    .eq("square_order_id", orderId)
    .maybeSingle();
  if (error) throw new Error(`backfill sticker lookup failed: ${error.message}`);
  if (!data?.sticker_number) return false;

  const { enqueueCupLabelJobs } = await import("./enqueue");
  await enqueueCupLabelJobs({
    order: args.order,
    stickerNumber: data.sticker_number,
    mode: args.mode,
  });
  return true;
}
