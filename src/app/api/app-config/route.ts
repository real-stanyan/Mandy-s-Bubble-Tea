import { NextResponse } from "next/server";
import { APP_CONFIG } from "@/lib/app-config-values";

// Min-version gate config for the native app. Static + CDN-cached on
// purpose (NOT force-dynamic): the app polls this on every cold start, and
// a 5-minute shared cache means a fleet of clients costs ~zero function
// invocations while a minBuild bump still propagates within minutes.
// The app fails open if this endpoint is unreachable — never the reverse.
export async function GET() {
  return NextResponse.json(
    { ok: true, ...APP_CONFIG },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
      },
    },
  );
}
