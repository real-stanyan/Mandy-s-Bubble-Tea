import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseRoute } from "@/lib/supabase-server";

// OAuth redirect callback. Supabase sends the browser back here with a
// `code` query param after Apple / Google sign-in; we exchange it for
// a session cookie and bounce the user on to the page they came from.
//
// This route MUST be server-side — exchangeCodeForSession needs to set
// the session cookie on the response before the browser follows the
// redirect. A Client Component page would not be able to do that.

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/account";

  if (!code) {
    return NextResponse.redirect(new URL("/account?auth_error=missing_code", url.origin));
  }

  const supabase = await getSupabaseRoute();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(
        `/account?auth_error=${encodeURIComponent(error.message)}`,
        url.origin,
      ),
    );
  }

  // Only allow same-origin redirects so a crafted `next` can't bounce
  // the user (with a fresh session) off to an attacker-controlled page.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/account";
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
