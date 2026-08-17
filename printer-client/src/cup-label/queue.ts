// printer-client/src/cup-label/queue.ts
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../supabase";
import { config } from "../config";
import { maybeAlert } from "../alert";
import { printCupLabelZPL, getCupLabelPrinterStatus } from "./printer";
import { downloadRasterZPL } from "./storage";

type CupLabelStatus = "pending" | "printing" | "printed" | "failed";

// Single-printer serialiser. Each cup_label_jobs INSERT triggers a
// Realtime callback; for a 3-cup order the three callbacks fire roughly
// simultaneously and each `await handleJob()` calls into libusb to
// open / claim / write / release the same USB device. The libusb
// wrapper isn't reentrant — the second print rams in mid-release of
// the first and the bus gets into a half-open state ("Device is not
// opened" on the release callback, plus the second print's ZPL stream
// gets interleaved with the first one's tail, producing a corrupted
// label). Serialising at the queue layer means any number of triggers
// (Realtime + poll + replay) all chain through one tail Promise.
let serial: Promise<void> = Promise.resolve();
function runSerial(row: CupLabelJobRow): Promise<void> {
  const next = serial.then(() => handleJob(row).catch((e) => {
    console.error("[cup-label/queue] handleJob threw:", e);
  }));
  // Reset to a resolved chain on rejection so a future throw can't kill
  // the serial pipeline (handleJob's own try/catch already neutralises
  // expected errors; this is the belt-and-braces).
  serial = next.catch(() => undefined);
  return next;
}

type CupLabelJobRow = {
  id: string;
  square_order_id: string;
  line_id: string;
  cup_idx: number;
  sticker_number: string;
  drink_name: string;
  modifiers_text: string;
  doodle_source: "user" | "default" | "ai";
  doodle_pool_key: string | null;
  // Storage-backed fallback. Newer rows leave this null and use
  // `zpl_body` instead — see handleJob() for the resolution order.
  raster_path: string | null;
  zpl_body: string | null;
  target_printer_kind: "zd410";
  status: CupLabelStatus;
  attempts: number;
  last_error: string | null;
  printer_token: string | null;
  created_at: string;
  printed_at: string | null;
  /** Scheduled pickup: don't print before this. NULL (and every row from
   *  before the column existed) = due immediately. */
  print_due_at?: string | null;
  /** The customer's chosen collection time. Already baked into `zpl_body`
   *  by the web renderer; kept on the row for the admin views and logs. */
  pickup_at?: string | null;
};

const TARGET_PRINTER_KIND = "zd410" as const;

/** Due filter shared by every pending-row query in this pipeline (replay,
 *  poll, heartbeat count, age watch): a held row is invisible until its
 *  print_due_at passes. PostgREST has no server-side now() inside a filter
 *  string, so the timestamp goes in inline. Mirrors ../queue.ts. */
export function dueFilter(): string {
  return `print_due_at.is.null,print_due_at.lte.${new Date().toISOString()}`;
}

/** Belt to the SELECTs' braces: a row can also arrive straight off the
 *  Realtime INSERT (which fires at enqueue time, long before due), so it is
 *  re-checked at handling time. */
export function isDue(job: CupLabelJobRow): boolean {
  if (!job.print_due_at) return true;
  const due = Date.parse(job.print_due_at);
  return Number.isNaN(due) || due <= Date.now();
}

/**
 * Runs once at start.
 *   1. Jobs older than the stale window (default 2h) are marked
 *      'failed' with last_error='stale: created_at older than window'.
 *      A row still waiting on its print_due_at is exempt — an order placed
 *      for a later pickup is deliberately old, not abandoned.
 *      cup_label_jobs has no 'stale' status (only pending/printing/
 *      printed/failed); doodle is a keepsake feature so age-bound jobs
 *      are deliberately dropped rather than printed late.
 *   2. Rows stuck in 'printing' from a previous crash are reset to
 *      'pending' so the new run can retry them. Single-consumer
 *      assumption: only one ZD410 launchd job runs at a time, so a
 *      stale 'printing' row is necessarily ours.
 *   3. Remaining pending jobs are processed in creation order.
 */
export async function replayOnStart(): Promise<void> {
  const cutoff = new Date(Date.now() - config.cupLabelStaleWindowMs).toISOString();

  const { error: staleErr } = await supabase
    .from("cup_label_jobs")
    .update({ status: "failed", last_error: "stale: row older than CUP_LABEL_STALE_WINDOW_MS" })
    .lt("created_at", cutoff)
    .or(dueFilter())
    .eq("target_printer_kind", TARGET_PRINTER_KIND)
    .in("status", ["pending", "printing"]);
  if (staleErr) console.error("[cup-label/queue] stale mark failed:", staleErr.message);

  const { error: releaseErr } = await supabase
    .from("cup_label_jobs")
    .update({ status: "pending", printer_token: null })
    .eq("target_printer_kind", TARGET_PRINTER_KIND)
    .eq("status", "printing");
  if (releaseErr) console.error("[cup-label/queue] release printing failed:", releaseErr.message);

  const { data, error } = await supabase
    .from("cup_label_jobs")
    .select("*")
    .eq("target_printer_kind", TARGET_PRINTER_KIND)
    .eq("status", "pending")
    .or(dueFilter())
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[cup-label/queue] replay select failed:", error.message);
    return;
  }
  for (const row of (data ?? []) as CupLabelJobRow[]) {
    await runSerial(row);
  }
}

let pollInFlight = false;
async function runPollOnce(reason: "tick" | "realtime-drop"): Promise<void> {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const { data, error } = await supabase
      .from("cup_label_jobs")
      .select("*")
      .eq("target_printer_kind", TARGET_PRINTER_KIND)
      .eq("status", "pending")
      .or(dueFilter())
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) {
      console.error(`[cup-label/queue] poll select failed (${reason}):`, error.message);
      return;
    }
    const rows = (data ?? []) as CupLabelJobRow[];
    if (rows.length > 0 && reason === "realtime-drop") {
      console.log(
        `[cup-label/queue] catch-up poll picked up ${rows.length} pending after realtime drop`,
      );
    }
    for (const row of rows) {
      await runSerial(row);
    }
  } catch (err) {
    console.error(`[cup-label/queue] poll tick failed (${reason}):`, err);
  } finally {
    pollInFlight = false;
  }
}

/**
 * Subscribes to INSERT events on cup_label_jobs via Supabase Realtime.
 * Mirrors the pattern in ../queue.ts so the two pipelines share their
 * disconnect-then-catch-up-poll behavior.
 */
export function subscribeCupLabelJobs(): { close: () => void } {
  let channel: RealtimeChannel | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let closed = false;

  const connect = () => {
    if (closed) return;
    channel = supabase
      .channel(`cup_label_jobs:${TARGET_PRINTER_KIND}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "cup_label_jobs",
          // Server-side filter so a future second consumer for a
          // different printer kind doesn't receive (and discard) this
          // consumer's INSERTs.
          filter: `target_printer_kind=eq.${TARGET_PRINTER_KIND}`,
        },
        async (payload) => {
          const row = payload.new as CupLabelJobRow;
          if (row.status !== "pending") return;
          if (row.target_printer_kind !== TARGET_PRINTER_KIND) return;
          // Scheduled pickup: the INSERT lands at checkout, minutes before
          // the drinks should be made. Drop it here — the poll tick picks
          // the row up on its own once print_due_at has passed.
          if (!isDue(row)) {
            console.log(
              `[cup-label/queue] holding ${row.sticker_number}#${row.cup_idx} until ${row.print_due_at}`,
            );
            return;
          }
          await runSerial(row);
        },
      )
      .subscribe((status) => {
        console.log(`[cup-label/queue] realtime status: ${status}`);
        if (status === "SUBSCRIBED") return;
        if (closed) return;
        runPollOnce("realtime-drop").catch(() => {
          /* logged inside */
        });
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (channel) {
            try {
              channel.unsubscribe();
            } catch {
              /* ignore */
            }
            channel = null;
          }
          connect();
        }, 3000);
      });
  };

  connect();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (channel) {
        try {
          channel.unsubscribe();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

export function startPollFallback(): NodeJS.Timeout {
  return setInterval(() => {
    runPollOnce("tick").catch(() => {
      /* logged inside */
    });
  }, config.cupLabelPollFallbackMs);
}

/**
 * Atomic per-id claim via the `claim_cup_label_job_by_id` RPC. The RPC
 * does a single UPDATE WHERE status='pending' (atomic in Postgres) and
 * properly bumps `attempts` instead of resetting it to 1, which is what
 * the previous Supabase JS update did — that bug meant the "alert
 * after 3 failures" logic in handleJob() never fired.
 *
 * Exported for testing; subscribeCupLabelJobs hot path passes the
 * Realtime payload row directly to handleJob, which then claims here.
 * Concurrent triggers (Realtime + poll + replay) all converge on a
 * single UPDATE, so only one consumer wins per row.
 */
export async function claimById(jobId: string): Promise<CupLabelJobRow | null> {
  const token = `${config.cupLabelDeviceId || "cup-label-consumer"}-${Date.now()}-${Math.floor(
    Math.random() * 1e6,
  )}`;
  const { data, error } = await supabase.rpc("claim_cup_label_job_by_id", {
    p_job_id: jobId,
    p_token: token,
  });
  if (error) {
    console.error(`[cup-label/queue] claim failed for ${jobId}:`, error.message);
    return null;
  }
  const rows = (data ?? []) as CupLabelJobRow[];
  return rows[0] ?? null;
}

/**
 * End-to-end handler for one cup_label_jobs row.
 *
 *   1. Atomically claim ('pending' -> 'printing'). If another instance
 *      already picked it up, the UPDATE affects zero rows and we exit.
 *   2. Gate on CUPS printer reachability — if offline, mark 'failed'
 *      immediately so CUPS doesn't silently buffer a backlog that
 *      flushes when the printer wakes up (matches ZD411 hot-path).
 *   3. Download the ZPL II text from Supabase Storage at raster_path.
 *   4. `lp -d Zebra_ZD410 -o raw` (with timeout).
 *   5. On success: mark 'printed' with printed_at.
 *      On failure: mark 'failed' with last_error; alert on 3rd attempt.
 */
export async function handleJob(job: CupLabelJobRow): Promise<void> {
  // Re-check before claiming: a replay list or Realtime payload built a
  // moment ago can carry a row whose hold hasn't expired.
  if (!isDue(job)) return;
  const claimed = await claimById(job.id);
  if (!claimed) return;

  const printerStatus = await getCupLabelPrinterStatus();
  if (printerStatus === "offline") {
    await supabase
      .from("cup_label_jobs")
      .update({
        status: "failed",
        last_error: `printer offline (${printerStatus})`,
        printer_token: null,
      })
      .eq("id", claimed.id);
    await maybeAlert(
      `cup-label printer ${config.cupLabelPrinterName} offline; job ${claimed.sticker_number} cup ${claimed.cup_idx + 1} not sent`,
    );
    return;
  }

  try {
    const zpl = await resolveZpl(claimed);
    await printCupLabelZPL(zpl);
    await supabase
      .from("cup_label_jobs")
      .update({
        status: "printed",
        printed_at: new Date().toISOString(),
        printer_token: null,
      })
      .eq("id", claimed.id);
    console.log(
      `[cup-label/queue] printed ${claimed.sticker_number} cup ${claimed.cup_idx + 1} (${claimed.drink_name})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // claimById (RPC) already incremented attempts atomically and
    // returned the post-increment value. So the row currently in DB
    // has `attempts = claimed.attempts`.
    const attempts = claimed.attempts;
    // Auto-retry: bounce back to 'pending' so the poll-fallback tick
    // picks it up again later (Realtime only fires on INSERT). Hard
    // 'failed' only on the final attempt — that's when the row stops
    // moving and the alert fires. Previous code marked 'failed' on
    // the first error so attempts could never reach the alert
    // threshold, and the operator would only learn of the dropped
    // cup when a customer complained.
    const isFinal = attempts >= CUP_LABEL_MAX_ATTEMPTS;
    const nextStatus: CupLabelStatus = isFinal ? "failed" : "pending";
    await supabase
      .from("cup_label_jobs")
      .update({
        status: nextStatus,
        last_error: message,
        printer_token: null,
      })
      .eq("id", claimed.id);
    console.error(
      `[cup-label/queue] ${nextStatus} ${claimed.sticker_number} cup ${claimed.cup_idx + 1} (attempts=${attempts}/${CUP_LABEL_MAX_ATTEMPTS}): ${message}`,
    );
    if (isFinal) {
      await maybeAlert(
        `cup-label print failed ${attempts}x for sticker ${claimed.sticker_number} cup ${claimed.cup_idx + 1}: ${message}`,
      );
    }
  }
}

const CUP_LABEL_MAX_ATTEMPTS = 3;

// Resolve the ZPL II text for a claimed job. Prefer the inline
// `zpl_body` column (introduced 2026-05-15) because it skips the
// Storage round-trip and has no partial-state window between the
// upload and the row insert. Fall back to the Storage `raster_path`
// only for legacy rows enqueued before the schema change.
async function resolveZpl(claimed: CupLabelJobRow): Promise<string> {
  if (claimed.zpl_body && claimed.zpl_body.length > 0) {
    return claimed.zpl_body;
  }
  if (claimed.raster_path) {
    return downloadRasterZPL(claimed.raster_path);
  }
  throw new Error(`no zpl_body or raster_path on job ${claimed.id}`);
}
