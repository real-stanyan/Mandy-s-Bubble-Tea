import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Get the next online order number for today (OL800, OL801, …).
 * Uses a PostgreSQL function for atomic increment.
 */
export async function nextOnlineOrderNumber(): Promise<string> {
  const { data, error } = await supabase.rpc("next_online_order_number");
  if (error) throw new Error(`Supabase order counter failed: ${error.message}`);
  return data as string;
}
