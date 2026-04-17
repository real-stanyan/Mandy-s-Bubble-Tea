import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client. Uses the service role key, which bypasses
// RLS — safe because every importer lives under src/app/api/* and never
// ships to the browser. Do NOT import this module from client components.

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env vars are not configured (need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  _supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supabase;
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
 * Returns whether the customer has an unused welcome-discount row.
 * Returns { available: false, percentage: 0 } on any error (fail safe).
 */
export async function getWelcomeDiscountStatus(
  customerId: string,
): Promise<{ available: boolean; percentage: number }> {
  try {
    const { data, error } = await getSupabase()
      .from("welcome_discounts")
      .select("state,percentage")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { available: false, percentage: 0 };
    return {
      available: data.state === "unused",
      percentage: data.percentage ?? 30,
    };
  } catch (err) {
    console.error("[welcome-discount] status failed:", err);
    return { available: false, percentage: 0 };
  }
}

/**
 * Atomic consume via SQL function. Returns true iff this call was the
 * one that flipped the row from unused to used. Already-used, missing,
 * or errored → false (callers must not double-credit).
 */
export async function consumeWelcomeDiscount(
  customerId: string,
  orderId: string,
): Promise<boolean> {
  try {
    const { data, error } = await getSupabase().rpc(
      "consume_welcome_discount",
      { p_customer_id: customerId, p_order_id: orderId },
    );
    if (error) throw error;
    return Array.isArray(data) && data.length > 0 && data[0]?.consumed === true;
  } catch (err) {
    console.error("[welcome-discount] consume failed:", err);
    return false;
  }
}
