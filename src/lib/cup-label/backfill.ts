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
  /**
   * When > 0, wait this long BEFORE the cup_label_jobs count check.
   *
   * The printer-client fires on cup_label_jobs INSERT only, and the payment
   * route's authoritative enqueue is deferred via `after()` and lands as an
   * UPDATE-on-conflict (no second INSERT, status stays put, so it never
   * reprints). If the webhook inserts web-mode DEFAULTS (a random lucky cat)
   * the instant it sees an empty table, that default INSERT prints and the
   * customer's real choice (photo / sticker / drawing) is lost — the "photo
   * prints a tarot card" report, 2026-06-08.
   *
   * Delaying the check lets the just-deferred payment enqueue win the INSERT.
   * We only fall back to defaults if the order is genuinely still label-less
   * after the grace window (the true OL826 dead-lambda case). POS orders have
   * no racing payment route, so they pass graceMs=0 and stay immediate.
   */
  graceMs?: number;
}): Promise<boolean> {
  const orderId = args.order.id;
  if (!orderId) return false;
  if (args.graceMs && args.graceMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, args.graceMs));
  }
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
