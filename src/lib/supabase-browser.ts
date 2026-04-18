"use client";

import { createBrowserClient } from "@supabase/ssr";

// Supabase client for Client Components. The anon key is public — RLS on
// the Postgres tables is what actually protects user data. The client
// reads/writes the auth session cookie so subsequent fetches to our
// /api/* routes land with the user's JWT attached automatically.

let _browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowser() {
  if (_browserClient) return _browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "Supabase browser client is not configured (need NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)",
    );
  }
  _browserClient = createBrowserClient(url, anon);
  return _browserClient;
}
