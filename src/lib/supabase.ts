import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase env vars are not configured");
  }
  _supabase = createClient(url, key);
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
