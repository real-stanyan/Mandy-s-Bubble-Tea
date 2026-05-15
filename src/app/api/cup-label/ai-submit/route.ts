// src/app/api/cup-label/ai-submit/route.ts
//
// Submit-and-forget endpoint for AI doodles. Replaces the old
// /api/cup-label/ai-generate (synchronous, watch-the-spinner) flow.
//
// Behaviour:
//   • One row in `cup_label_ai_jobs` per (user_id, slot_key) — quota
//     enforced at the DB level via UNIQUE. A second submission for
//     the same slot returns the existing aiDoodleId — Doubao is never
//     called twice for the same cup.
//   • Doubao + binarize + Storage upload runs in Vercel `waitUntil`
//     so the customer's HTTP response returns in ~50ms regardless of
//     upstream latency.
//   • Spec: docs/superpowers/specs/2026-05-15-async-ai-doodle-design.md

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { processAiJob } from "@/lib/cup-label/ai-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Submit returns in well under 1s; the actual Doubao call runs after
// the response via `after()` (Next 15+ replacement for waitUntil).
export const maxDuration = 90;

const MAX_PROMPT_LEN = 200;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

type Body = {
  /** "{clientLineId}:{cupIdx}" — matches the cart's slot keying. */
  slotKey: string;
  prompt: string;
  /** Optional reference image (data URI or raw base64) for image-to-image. */
  sourceImageBase64?: string;
};

function isValidBody(body: unknown): body is Body {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<Body>;
  if (typeof b.slotKey !== "string" || b.slotKey.trim().length === 0) return false;
  if (typeof b.prompt !== "string" || b.prompt.trim().length === 0) return false;
  if (b.sourceImageBase64 !== undefined && typeof b.sourceImageBase64 !== "string") return false;
  return true;
}

function decodeBase64Image(input: string): Buffer {
  const match = input.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  const raw = match ? match[1] : input;
  return Buffer.from(raw, "base64");
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
    return NextResponse.json(
      { ok: false, error: "Missing slotKey or prompt" },
      { status: 400 },
    );
  }

  const slotKey = body.slotKey.trim();
  const prompt = body.prompt.trim();
  if (prompt.length > MAX_PROMPT_LEN) {
    return NextResponse.json(
      { ok: false, error: `Prompt too long (max ${MAX_PROMPT_LEN} chars)` },
      { status: 400 },
    );
  }

  // Decode + size-check source image (if any) on the request thread
  // so we can 4xx fast on bad input. The actual sharp resize + Storage
  // upload happens in the background after we hand off to processAiJob.
  let sourceImage: Buffer | undefined;
  if (body.sourceImageBase64) {
    const decoded = decodeBase64Image(body.sourceImageBase64);
    if (decoded.length === 0) {
      return NextResponse.json({ ok: false, error: "Empty source image" }, { status: 400 });
    }
    if (decoded.length > MAX_SOURCE_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: `Source image too large (max ${MAX_SOURCE_BYTES / 1024 / 1024} MB)`,
        },
        { status: 413 },
      );
    }
    sourceImage = decoded;
  }

  const sb = getSupabaseAdmin();

  // Idempotency check: same (user, slot) → return existing job. The
  // client will see the same aiDoodleId from the original submission
  // and the modal stays disabled, so this is a defence-in-depth in
  // case the client somehow bypasses its own "already submitted" UI
  // state. We never re-trigger processAiJob on a duplicate request —
  // Doubao is called at most once per slot per customer.
  const { data: existing } = await sb
    .from("cup_label_ai_jobs")
    .select("id, status")
    .eq("user_id", user.userId)
    .eq("slot_key", slotKey)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({
      ok: true,
      aiDoodleId: existing.id,
      status: existing.status,
      reused: true,
    });
  }

  // First submission for this slot — insert pending row, then queue
  // the background work via Next 15 `after()`. The row's id IS the
  // aiDoodleId we return to the client; processAiJob will upload to
  // `${userId}/ai/${jobId}.png` so loadAiDoodleUpload's path resolution
  // stays trivial.
  const { data: inserted, error: insErr } = await sb
    .from("cup_label_ai_jobs")
    .insert({
      user_id: user.userId,
      slot_key: slotKey,
      prompt,
      status: "pending",
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    // Race: another concurrent submit for the same slot won the unique
    // constraint. Re-query and treat as duplicate.
    if (insErr?.code === "23505") {
      const { data: dup } = await sb
        .from("cup_label_ai_jobs")
        .select("id, status")
        .eq("user_id", user.userId)
        .eq("slot_key", slotKey)
        .maybeSingle();
      if (dup) {
        return NextResponse.json({
          ok: true,
          aiDoodleId: dup.id,
          status: dup.status,
          reused: true,
        });
      }
    }
    console.error("[ai-submit] insert failed:", insErr?.message);
    return NextResponse.json({ ok: false, error: "Submit failed" }, { status: 500 });
  }

  // Schedule the Doubao call to run after the response returns. The
  // dev `npm run dev` and Vercel prod both honour `after()`. Failures
  // mutate the row to status='failed' inside processAiJob — they don't
  // surface back here.
  after(
    processAiJob({
      jobId: inserted.id,
      userId: user.userId,
      prompt,
      sourceImage,
    }),
  );

  return NextResponse.json({
    ok: true,
    aiDoodleId: inserted.id,
    status: "pending",
    reused: false,
  });
}
