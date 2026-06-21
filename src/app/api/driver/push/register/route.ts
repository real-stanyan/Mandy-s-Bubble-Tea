import { NextResponse } from "next/server";
import { authDriver } from "@/lib/driver-auth";
import { upsertDriverPushToken } from "@/lib/driver-tokens";

// Driver app registers its Expo push token after login + notification
// permission grant. Bearer-guarded (shared store password).

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authDriver(request);
  if (!auth.ok) {
    if (auth.reason === "unconfigured") {
      return NextResponse.json({ ok: false }, { status: 500 });
    }
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    token?: string;
    platform?: string;
    label?: string;
    appVersion?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const token = String(body.token ?? "");
  const platform = body.platform === "android" ? "android" : "ios";
  if (!token) {
    return NextResponse.json({ ok: false, error: "token required" }, { status: 400 });
  }

  try {
    await upsertDriverPushToken({
      token,
      platform,
      label: body.label ?? null,
      appVersion: body.appVersion ?? null,
      driverId: auth.driverId ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[driver/push/register]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
