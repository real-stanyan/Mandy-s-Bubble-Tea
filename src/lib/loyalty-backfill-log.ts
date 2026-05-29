import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export type BackfillSource = "webhook" | "cron" | "retro";

/**
 * Atomically claim the right to backfill this order. Inserts a ledger
 * row; the PRIMARY KEY on square_order_id means a concurrent claim (or
 * a prior backfill) surfaces as Postgres 23505 → returns false so the
 * caller skips. Same pattern as claimOrderPushSlot.
 */
export async function claimBackfillSlot(
  orderId: string,
  source: BackfillSource,
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("loyalty_backfill_log")
    .insert({ square_order_id: orderId, source });
  if (error) {
    if (error.code === "23505") return false;
    throw new Error(`claimBackfillSlot: ${error.message}`);
  }
  return true;
}

/**
 * Release a previously-claimed slot. Called when we decide NOT to
 * accrue after claiming (Square already accrued, no phone) or when the
 * accrual throws — so the order stays eligible for a later retry.
 */
export async function releaseBackfillSlot(orderId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  await admin
    .from("loyalty_backfill_log")
    .delete()
    .eq("square_order_id", orderId);
}

/** Record the account that received the backfilled star (audit). */
export async function recordBackfillResult(
  orderId: string,
  loyaltyAccountId: string,
): Promise<void> {
  const admin = getSupabaseAdmin();
  await admin
    .from("loyalty_backfill_log")
    .update({ loyalty_account_id: loyaltyAccountId })
    .eq("square_order_id", orderId);
}
