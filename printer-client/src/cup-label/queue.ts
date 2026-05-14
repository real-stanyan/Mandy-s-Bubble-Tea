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
  doodle_source: "user" | "default";
  doodle_pool_key: string | null;
  raster_path: string;
  status: CupLabelStatus;
  attempts: number;
  last_error: string | null;
  printer_token: string | null;
  created_at: string;
  printed_at: string | null;
};

/**
 * Runs once at start.
 *   1. Jobs older than the stale window (default 2h) are marked
 *      'failed' with last_error='stale: created_at older than window'.
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
    .in("status", ["pending", "printing"]);
  if (staleErr) console.error("[cup-label/queue] stale mark failed:", staleErr.message);

  const { error: releaseErr } = await supabase
    .from("cup_label_jobs")
    .update({ status: "pending", printer_token: null })
    .eq("status", "printing");
  if (releaseErr) console.error("[cup-label/queue] release printing failed:", releaseErr.message);

  const { data, error } = await supabase
    .from("cup_label_jobs")
    .select("*")
    .eq("status", "pending")
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
      .eq("status", "pending")
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
      .channel("cup_label_jobs")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "cup_label_jobs" },
        async (payload) => {
          const row = payload.new as CupLabelJobRow;
          if (row.status !== "pending") return;
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
 * Atomic claim via the `claim_oldest_cup_label_job` RPC defined in
 * 2026-04-27-claim-cup-label-job.sql. The RPC uses `FOR UPDATE SKIP
 * LOCKED` so concurrent callers never double-claim. We then look up
 * the full row by id — the RPC only returns (id, raster_path,
 * printer_token).
 *
 * Exported for testing; subscribeCupLabelJobs hot path uses the payload
 * row directly, which lets us start downloading the raster before the
 * claim returns. We still call this to flip the row to 'printing'.
 */
export async function claimById(jobId: string): Promise<CupLabelJobRow | null> {
  const token = `${config.cupLabelDeviceId || "cup-label-consumer"}-${Date.now()}-${Math.floor(
    Math.random() * 1e6,
  )}`;
  const { data, error } = await supabase
    .from("cup_label_jobs")
    .update({
      status: "printing",
      printer_token: token,
      attempts: 1,
    })
    .eq("id", jobId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) {
    console.error(`[cup-label/queue] claim failed for ${jobId}:`, error.message);
    return null;
  }
  return (data as CupLabelJobRow | null) ?? null;
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
    const zpl = await downloadRasterZPL(claimed.raster_path);
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
    const newAttempts = claimed.attempts; // claimById already bumped to 1
    await supabase
      .from("cup_label_jobs")
      .update({
        status: "failed",
        last_error: message,
        printer_token: null,
      })
      .eq("id", claimed.id);
    console.error(
      `[cup-label/queue] failed ${claimed.sticker_number} cup ${claimed.cup_idx + 1}: ${message}`,
    );
    if (newAttempts >= 3) await maybeAlert(`cup-label print failed ${newAttempts}x: ${message}`);
  }
}
