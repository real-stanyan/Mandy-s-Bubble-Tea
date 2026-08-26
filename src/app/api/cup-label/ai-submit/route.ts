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
import {
  MEMORY_STAMP_STYLE_ID,
  buildMemoryStampPrompt,
} from "@/lib/cup-label/stamp-style";
import {
  PHOTO_LABELS_OFFLINE,
  PHOTO_LABELS_OFFLINE_NOTICE,
} from "@/lib/cup-label/label-mode";

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
  /**
   * Curated style. "memory-stamp" turns the reference photo's subject into a
   * seal-stamp graphic using a server-side prompt — the customer's own text
   * is ignored (the style IS the prompt), and a reference image is required
   * (there is no subject to stamp without one).
   */
  style?: string;
  /** Optional reference image (data URI or raw base64) for image-to-image. */
  sourceImageBase64?: string;
  /**
   * Opaque per-cart identifier from the local cart store. Without
   * this, the (user_id, slot_key) UNIQUE would lock the same drink
   * + cup_idx for the lifetime of the account — a returning customer
   * who orders the same Pearl Milk Tea cup 0 next week would get
   * last week's AI image back instead of a fresh one. With it, the
   * quota correctly scopes to a single shopping session.
   *
   * Optional for backward compat with any in-flight pre-cutover
   * clients; new clients must always send it.
   */
  cartSessionId?: string;
};

function isValidBody(body: unknown): body is Body {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<Body>;
  if (typeof b.slotKey !== "string" || b.slotKey.trim().length === 0) return false;
  if (typeof b.prompt !== "string" || b.prompt.trim().length === 0) return false;
  if (b.style !== undefined && typeof b.style !== "string") return false;
  if (b.sourceImageBase64 !== undefined && typeof b.sourceImageBase64 !== "string") return false;
  if (b.cartSessionId !== undefined && typeof b.cartSessionId !== "string") return false;
  return true;
}

function decodeBase64Image(input: string): Buffer {
  const match = input.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  const raw = match ? match[1] : input;
  return Buffer.from(raw, "base64");
}

export async function POST(request: NextRequest) {
  // 40×30 text-only paper mode: custom labels can't print — reject early.
  // See lib/cup-label/label-mode.ts.
  if (PHOTO_LABELS_OFFLINE) {
    return NextResponse.json(
      { ok: false, error: "photo_labels_offline", message: PHOTO_LABELS_OFFLINE_NOTICE },
      { status: 503 },
    );
  }
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

  const rawSlotKey = body.slotKey.trim();
  // The effective DB slot_key prepends the cart-session id when the
  // client provides one. This is the fix for the "new prompt prints
  // old image" bug — without the session prefix, returning customers
  // hitting the same drink+modifier combo would silently reuse a
  // previous cart's AI image because of UNIQUE(user_id, slot_key).
  const cartSessionId = body.cartSessionId?.trim() ?? "";
  const slotKey = cartSessionId ? `${cartSessionId}:${rawSlotKey}` : rawSlotKey;
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

  // Curated style gate. Unknown style ids 400 rather than silently running
  // freeform — a typo'd style must not quietly produce the wrong product.
  const style = body.style?.trim() || undefined;
  if (style !== undefined && style !== MEMORY_STAMP_STYLE_ID) {
    return NextResponse.json({ ok: false, error: "Unknown style" }, { status: 400 });
  }
  if (style === MEMORY_STAMP_STYLE_ID && !sourceImage) {
    // No photo → no subject to stamp. The client requires one before submit;
    // this is the server-side backstop (it existed in the original #169
    // change and was lost in a merge — restored 2026-08-09).
    return NextResponse.json(
      { ok: false, error: "Memory Stamp needs a photo" },
      { status: 400 },
    );
  }
  // The prompt Doubao actually sees. For Memory Stamp the server-side style
  // prompt replaces the customer's text entirely — the style is the product,
  // and freeform steering is how the subject stops being theirs. The DB row
  // keeps a style marker instead so support can tell the flows apart.
  const promptForModel =
    style === MEMORY_STAMP_STYLE_ID ? buildMemoryStampPrompt() : prompt;
  const promptForAudit =
    style === MEMORY_STAMP_STYLE_ID ? `[${MEMORY_STAMP_STYLE_ID}]` : prompt;

  const sb = getSupabaseAdmin();

  // Idempotency check: same (user, slot) → the existing job answers, UNLESS
  // the customer has actually changed their input. The original rule was
  // "Doubao is never called twice for the same slot", and its blind spot
  // shipped a bride from last week: swap the photo, tap Generate, and the
  // server silently handed back the OLD job's image (Stan, on production,
  // 2026-08-09 — the printed label was a previously uploaded photo).
  //
  // Regenerate — same row, same aiDoodleId, fresh Doubao run — when the
  // resubmission carries a source image or a different prompt: both only
  // happen from a deliberate customer action, and the result PNG overwrites
  // the same storage path (upsert). A byte-identical duplicate (double-tap,
  // client retry) still reuses, and a job already mid-flight is never
  // double-run.
  const { data: existing } = await sb
    .from("cup_label_ai_jobs")
    .select("id, status, prompt")
    .eq("user_id", user.userId)
    .eq("slot_key", slotKey)
    .maybeSingle();
  if (existing) {
    const inputChanged =
      sourceImage !== undefined || existing.prompt !== promptForAudit;
    if (!inputChanged || existing.status === "pending") {
      return NextResponse.json({
        ok: true,
        aiDoodleId: existing.id,
        status: existing.status,
        reused: true,
      });
    }
    const { error: updErr } = await sb
      .from("cup_label_ai_jobs")
      .update({ prompt: promptForAudit, status: "pending" })
      .eq("id", existing.id);
    if (updErr) {
      console.error("[ai-submit] regenerate update failed:", updErr.message);
      return NextResponse.json({ ok: false, error: "Submit failed" }, { status: 500 });
    }
    after(
      processAiJob({
        jobId: existing.id,
        userId: user.userId,
        prompt: promptForModel,
        sourceImage,
      }),
    );
    return NextResponse.json({
      ok: true,
      aiDoodleId: existing.id,
      status: "pending",
      reused: false,
    });
  }

  // No photo → no subject to stamp. The client requires one before submit;
  // this is the server-side backstop. It sits *after* the idempotency lookup
  // on purpose: reopening the picker while a stamp job is still pending
  // re-submits without re-attaching the photo, and 400ing there would make
  // the client clear a job that was about to succeed.
  if (style === MEMORY_STAMP_STYLE_ID && !sourceImage) {
    return NextResponse.json(
      { ok: false, error: "Memory Stamp needs a photo" },
      { status: 400 },
    );
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
      prompt: promptForAudit,
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
      prompt: promptForModel,
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
