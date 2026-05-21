import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { saveUserDoodleUpload } from "@/lib/doodle/upload-store";
import type { SvgPath } from "@/lib/doodle/render-svg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UploadBody = { paths: SvgPath[] };

function isValidBody(body: unknown): body is UploadBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<UploadBody>;
  return Array.isArray(b.paths);
}

export async function POST(request: NextRequest) {
  const user = await getAuthedUser(request);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isValidBody(body)) {
    return NextResponse.json({ ok: false, error: "Missing paths array" }, { status: 400 });
  }

  try {
    const { doodleId } = await saveUserDoodleUpload({
      userId: user.userId,
      paths: body.paths,
    });
    return NextResponse.json({ ok: true, doodleId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upload failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
