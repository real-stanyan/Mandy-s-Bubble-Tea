import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { upsertDevicePushToken, deleteDevicePushToken } from "@/lib/push-tokens";

export const dynamic = "force-dynamic";

type RegisterBody = {
  token: string;
  platform: "ios" | "android";
  appVersion?: string | null;
};

function isValidPlatform(p: unknown): p is "ios" | "android" {
  return p === "ios" || p === "android";
}

export async function POST(request: Request) {
  const user = await getAuthedUser(request);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (typeof body.token !== "string" || body.token.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Missing token" },
      { status: 400 },
    );
  }
  if (!isValidPlatform(body.platform)) {
    return NextResponse.json(
      { ok: false, error: "Invalid platform" },
      { status: 400 },
    );
  }

  try {
    await upsertDevicePushToken({
      userId: user.userId,
      token: body.token,
      platform: body.platform,
      appVersion: body.appVersion ?? null,
    });
  } catch (err) {
    console.error("[device-push-token] upsert failed:", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const user = await getAuthedUser(request);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Missing token query param" },
      { status: 400 },
    );
  }

  try {
    await deleteDevicePushToken(token);
  } catch (err) {
    console.error("[device-push-token] delete failed:", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
