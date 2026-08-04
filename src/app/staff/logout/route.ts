import { NextResponse } from "next/server";
import { STAFF_COOKIE, STAFF_COOKIE_OPTIONS } from "@/lib/staff/auth";

// Sign out. Needed because the cookie is httpOnly and lasts two months, so
// without this the only way to switch between the staff and owner codes on a
// shared shop tablet is to clear site data by hand.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/staff/login", request.url), {
    status: 303,
  });
  response.cookies.set(STAFF_COOKIE, "", { ...STAFF_COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
