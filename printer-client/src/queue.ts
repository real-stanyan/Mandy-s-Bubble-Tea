// printer-client/src/queue.ts
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { config } from "./config";
import { printZPL, getPrinterStatus } from "./printer";
import { renderStickerZPL, type CupForZPL } from "./zpl";
import { maybeAlert } from "./alert";

type PrintJobRow = {
  id: string;
  square_order_id: string;
  source: "web" | "pos";
  sticker_number: string;
  order_total_cents: number;
  cups: Array<{
    drinkName: string;
    toppings: string[];
    ice: string | null;
    sugar: string | null;
    priceCents: number;
  }>;
  status: "pending" | "printing" | "printed" | "failed" | "stale";
  attempts: number;
  last_error: string | null;
  claimed_by: string | null;
  printed_cup_count: number;
  created_at: string;
};

/**
 * Runs once at start. Jobs older than the stale window are marked
 * 'stale'; remaining pending jobs are processed in creation order.
 * Also releases any 'printing' rows previously claimed by THIS
 * device so they can be re-attempted after a crash/restart.
 */
export async function replayOnStart(): Promise<void> {
  const cutoff = new Date(Date.now() - config.staleWindowMs).toISOString();
  const { error: staleErr } = await supabase
    .from("print_jobs")
    .update({ status: "stale" })
    .lt("created_at", cutoff)
    .in("status", ["pending", "printing"]);
  if (staleErr) console.error("[queue] stale mark failed:", staleErr.message);

  // Release our own in-flight claims from a previous run.
  const { error: releaseErr } = await supabase
    .from("print_jobs")
    .update({ status: "pending", claimed_by: null })
    .eq("status", "printing")
    .eq("claimed_by", config.deviceId);
  if (releaseErr) console.error("[queue] release claims failed:", releaseErr.message);

  const { data, error } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[queue] replay select failed:", error.message);
    return;
  }
  for (const row of (data ?? []) as PrintJobRow[]) {
    await handleJob(row);
  }
}

/**
 * Subscribes to INSERT events on print_jobs via Supabase Realtime.
 * On any non-SUBSCRIBED status (CHANNEL_ERROR / TIMED_OUT / CLOSED)
 * tears the channel down and resubscribes after a short delay.
 * Returns a handle the caller can close on shutdown.
 */
export function subscribePrintJobs(): { close: () => void } {
  let channel: RealtimeChannel | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let closed = false;

  const connect = () => {
    if (closed) return;
    channel = supabase
      .channel("print_jobs")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "print_jobs" },
        async (payload) => {
          const row = payload.new as PrintJobRow;
          if (row.status !== "pending") return;
          await handleJob(row);
        },
      )
      .subscribe((status) => {
        console.log(`[queue] realtime status: ${status}`);
        if (status === "SUBSCRIBED") return;
        if (closed) return;
        // Any non-subscribed status means we're no longer receiving
        // events. Tear down and retry after a short delay.
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (channel) {
            try { channel.unsubscribe(); } catch { /* ignore */ }
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
        try { channel.unsubscribe(); } catch { /* ignore */ }
      }
    },
  };
}

/**
 * Fallback poller. Every `pollFallbackMs` this scans for pending
 * jobs and processes them. Covers the case where Realtime silently
 * dropped an INSERT event (rare but observed). `handleJob`'s claim
 * step makes this safe against concurrent delivery — whichever
 * path gets there first wins.
 */
export function startPollFallback(): NodeJS.Timeout {
  const tick = async () => {
    try {
      const { data, error } = await supabase
        .from("print_jobs")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(20);
      if (error) {
        console.error("[queue] poll select failed:", error.message);
        return;
      }
      for (const row of (data ?? []) as PrintJobRow[]) {
        await handleJob(row);
      }
    } catch (err) {
      console.error("[queue] poll tick failed:", err);
    }
  };
  return setInterval(tick, config.pollFallbackMs);
}

async function claim(jobId: string): Promise<PrintJobRow | null> {
  const { data, error } = await supabase
    .from("print_jobs")
    .update({ status: "printing", claimed_by: config.deviceId })
    .eq("id", jobId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) {
    console.error(`[queue] claim failed for ${jobId}:`, error.message);
    return null;
  }
  return (data as PrintJobRow | null) ?? null;
}

export async function handleJob(job: PrintJobRow): Promise<void> {
  // Atomic claim. If somebody else already picked it up (or it's
  // already printed/failed/stale), UPDATE ... WHERE status='pending'
  // affects zero rows and .maybeSingle() returns null.
  const claimed = await claim(job.id);
  if (!claimed) return;

  // Gate on printer reachability. If offline, don't send the job
  // to CUPS — CUPS would silently queue it and flush a backlog the
  // moment the printer wakes up. Mark failed + alert.
  const printerStatus = await getPrinterStatus();
  if (printerStatus === "offline") {
    await supabase
      .from("print_jobs")
      .update({
        status: "failed",
        attempts: claimed.attempts + 1,
        last_error: `printer offline (${printerStatus})`,
        claimed_by: null,
      })
      .eq("id", claimed.id);
    await maybeAlert(`printer offline, job ${claimed.sticker_number} not sent`);
    return;
  }

  const startFrom = claimed.printed_cup_count ?? 0;
  try {
    const orderTime = formatLocalTime(claimed.created_at);
    for (let i = startFrom; i < claimed.cups.length; i++) {
      const c = claimed.cups[i];
      const zpl = renderStickerZPL({
        stickerNumber: claimed.sticker_number,
        orderTime,
        drinkName: c.drinkName,
        toppings: c.toppings,
        ice: c.ice,
        sugar: c.sugar,
        cupIndex: i + 1,
        cupTotal: claimed.cups.length,
        priceCents: c.priceCents,
      } satisfies CupForZPL);
      await printZPL(zpl);
      // Persist per-cup progress so a crash between cups doesn't
      // reprint cups that already emitted.
      await supabase
        .from("print_jobs")
        .update({ printed_cup_count: i + 1 })
        .eq("id", claimed.id);
    }
    await supabase
      .from("print_jobs")
      .update({
        status: "printed",
        printed_at: new Date().toISOString(),
        claimed_by: null,
      })
      .eq("id", claimed.id);
    console.log(`[queue] printed ${claimed.sticker_number} (${claimed.cups.length} cups)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const newAttempts = claimed.attempts + 1;
    await supabase
      .from("print_jobs")
      .update({
        status: "failed",
        attempts: newAttempts,
        last_error: message,
        claimed_by: null,
      })
      .eq("id", claimed.id);
    console.error(`[queue] failed ${claimed.sticker_number}: ${message}`);
    if (newAttempts >= 3) await maybeAlert(`print failed ${newAttempts}x: ${message}`);
  }
}

/**
 * Formats an ISO timestamp into 'HH:mm' in Australia/Brisbane.
 */
function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-AU", {
    timeZone: "Australia/Brisbane",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
