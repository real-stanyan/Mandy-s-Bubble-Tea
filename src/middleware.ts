import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Pre-launch site gate. If SITE_ACCESS_PASSWORD is set, every request
// needs either (a) a matching cookie, or (b) a path in the open list.
// HTML requests without the cookie get redirected to /access; API
// requests get a plain 401. Remove this block once public beta opens.
const GATE_COOKIE = "mbt_access";

// Always-open paths:
// - /access:           the gate page itself
// - /api/site-access:  endpoint that validates the password
// - /api/webhooks:     Square / Supabase server-to-server hits that can't send cookies
const OPEN_PREFIXES = ["/access", "/api/site-access", "/api/webhooks"];

function isOpenPath(pathname: string) {
  return OPEN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function checkSiteGate(request: NextRequest): Response | null {
  const expected = process.env.SITE_ACCESS_PASSWORD;
  if (!expected) return null;

  const { pathname } = request.nextUrl;
  if (isOpenPath(pathname)) return null;

  const cookie = request.cookies.get(GATE_COOKIE)?.value;
  if (cookie && cookie === expected) return null;

  if (pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "site gate" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/access";
  url.search = "";
  url.searchParams.set("from", pathname + (request.nextUrl.search ?? ""));
  return NextResponse.redirect(url);
}

// Refresh the Supabase session cookie on every request so that access
// tokens don't silently expire between page loads. Without this,
// Server Components and Route Handlers receive a stale JWT and
// authenticated requests quietly 401 a few hours after sign-in.

export async function middleware(request: NextRequest) {
  const gated = checkSiteGate(request);
  if (gated) return gated;

  const response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anon) return response;

  const supabase = createServerClient(supabaseUrl, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookieList) {
        for (const { name, value, options } of cookieList) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico)$).*)"],
};
