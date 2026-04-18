import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Two server-side Supabase clients, one per use-case:
//
// - `getSupabaseRoute()`   — user-scoped. Reads the session cookie from
//                            the incoming request; RLS applies. Use from
//                            Route Handlers and Server Components when
//                            you want to act AS the logged-in user.
// - `getSupabaseAdmin()`   — service-role. Bypasses RLS. Use for writes
//                            that span users (e.g. looking up a profile
//                            by phone during OTP linking) or for
//                            verifying a JWT that came in via the
//                            Authorization header (native mobile flow).
//
// Client Components must use `getSupabaseBrowser()` from supabase-browser.

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`${name} is not set`);
  return val;
}

function supabasePublishableKey(): string {
  const val =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!val) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set (accepted alias: NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    );
  }
  return val;
}

/**
 * Session-aware Supabase client for App Router Route Handlers. Cookies
 * come from `next/headers`, which is async in Next.js 16.
 */
export async function getSupabaseRoute() {
  const store = await cookies();
  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    supabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return store.getAll();
        },
        setAll(cookieList) {
          try {
            for (const { name, value, options } of cookieList) {
              store.set(name, value, options);
            }
          } catch {
            // Thrown when called from a Server Component (read-only
            // cookies). The middleware refreshes the session on every
            // request, so ignoring here is safe.
          }
        },
      },
    },
  );
}

let _admin: SupabaseClient | null = null;
export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _admin;
}
