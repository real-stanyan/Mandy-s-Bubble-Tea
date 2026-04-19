import "server-only";
import { getSupabaseAdmin } from "./supabase-server";

// Business-logic helpers built on top of the service-role Supabase
// client. The client itself lives in supabase-server.ts; this module
// keeps domain helpers (order counter, welcome discount) separate so
// API routes don't import setup code and setup code doesn't know about
// domain logic.

function getSupabase() {
  return getSupabaseAdmin();
}

/**
 * Get the next online order number for today (OL800, OL801, …).
 * Uses a PostgreSQL function for atomic increment.
 */
export async function nextOnlineOrderNumber(): Promise<string> {
  const { data, error } = await getSupabase().rpc("next_online_order_number");
  if (error) throw new Error(`Supabase order counter failed: ${error.message}`);
  return data as string;
}

/**
 * Insert a welcome_discounts row for a newly-created customer.
 * Idempotent via upsert with ignoreDuplicates. Called after a fresh
 * Square customer is created in /api/customer. Swallows errors — must
 * never block signup.
 */
export async function grantWelcomeDiscount(customerId: string): Promise<void> {
  try {
    const { error } = await getSupabase()
      .from("welcome_discounts")
      .upsert(
        { customer_id: customerId },
        { onConflict: "customer_id", ignoreDuplicates: true },
      );
    if (error) throw error;
  } catch (err) {
    console.error("[welcome-discount] grant failed:", err);
  }
}

/**
 * Returns the customer's welcome discount state: whether any drinks
 * remain under their allowance (`available`), the 30% rate, and the
 * raw `drinksRemaining` count (0, 1, or 2) so the UI can say "1 drink
 * left on your welcome discount".
 *
 * Returns a disabled shape on any error — callers must never 500 on
 * status lookups.
 */
export async function getWelcomeDiscountStatus(
  customerId: string,
): Promise<{ available: boolean; percentage: number; drinksRemaining: number }> {
  try {
    const { data, error } = await getSupabase()
      .from("welcome_discounts")
      .select("drinks_remaining,percentage")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { available: false, percentage: 0, drinksRemaining: 0 };
    const remaining = data.drinks_remaining ?? 0;
    return {
      available: remaining > 0,
      percentage: data.percentage ?? 30,
      drinksRemaining: remaining,
    };
  } catch (err) {
    console.error("[welcome-discount] status failed:", err);
    return { available: false, percentage: 0, drinksRemaining: 0 };
  }
}

/**
 * Tear down every Supabase-side trace of an account when the Square
 * customer is gone (deleted in Square Dashboard, or detected missing on
 * session resume). Deletes the auth.users row (user_profiles cascades
 * via FK) and the welcome_discounts row (not FK-linked). Pass whichever
 * handle you have; we look up the missing one.
 *
 * Idempotent and swallows errors — callers must not block on cleanup.
 */
export async function purgeAccount(args: {
  userId?: string;
  customerId?: string;
}): Promise<void> {
  const admin = getSupabase();
  let { userId, customerId } = args;

  try {
    if (!userId && customerId) {
      const { data } = await admin
        .from("user_profiles")
        .select("user_id")
        .eq("square_customer_id", customerId)
        .maybeSingle();
      userId = data?.user_id ?? undefined;
    } else if (userId && !customerId) {
      const { data } = await admin
        .from("user_profiles")
        .select("square_customer_id")
        .eq("user_id", userId)
        .maybeSingle();
      customerId = data?.square_customer_id ?? undefined;
    }

    if (customerId) {
      const { error } = await admin
        .from("welcome_discounts")
        .delete()
        .eq("customer_id", customerId);
      if (error) console.error("[purge] welcome_discounts delete", error);
    }

    if (userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) console.error("[purge] auth.admin.deleteUser", error);
    }
  } catch (err) {
    console.error("[purge] failed", err);
  }
}

/**
 * Atomically decrements drinks_remaining by at most `count`. Returns
 * `{ consumedCount, drinksRemaining }` reflecting the post-call state.
 * Already-zero or missing rows return `{ consumedCount: 0, drinksRemaining: 0 }`.
 * Callers must not treat any partial consumption as "fully used" — the
 * row is only terminal when drinksRemaining hits 0.
 */
export async function consumeWelcomeDiscount(
  customerId: string,
  orderId: string,
  count: number,
): Promise<{ consumedCount: number; drinksRemaining: number }> {
  try {
    const { data, error } = await getSupabase().rpc(
      "consume_welcome_discount",
      {
        p_customer_id: customerId,
        p_order_id: orderId,
        p_count: count,
      },
    );
    if (error) throw error;
    const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (!row) return { consumedCount: 0, drinksRemaining: 0 };
    return {
      consumedCount: Number(row.consumed_count ?? 0),
      drinksRemaining: Number(row.drinks_remaining ?? 0),
    };
  } catch (err) {
    console.error("[welcome-discount] consume failed:", err);
    return { consumedCount: 0, drinksRemaining: 0 };
  }
}
