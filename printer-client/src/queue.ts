// printer-client/src/queue.ts
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { printZPL } from "./printer";
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
  status: "pending" | "printed" | "failed" | "stale";
  attempts: number;
  last_error: string | null;
  created_at: string;
};

const REPLAY_WINDOW_MS = 10 * 60 * 1000;

/**
 * Runs once at start. Jobs older than the replay window are marked
 * 'stale'; remaining pending jobs are processed in creation order.
 */
export async function replayOnStart(): Promise<void> {
  const cutoff = new Date(Date.now() - REPLAY_WINDOW_MS).toISOString();
  const { error: staleErr } = await supabase
    .from("print_jobs")
    .update({ status: "stale" })
    .lt("created_at", cutoff)
    .eq("status", "pending");
  if (staleErr) console.error("[queue] stale mark failed:", staleErr.message);

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
 * Returns the channel so the caller can unsubscribe on shutdown.
 */
export function subscribePrintJobs(): RealtimeChannel {
  return supabase
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
    });
}

export async function handleJob(job: PrintJobRow): Promise<void> {
  try {
    const orderTime = formatLocalTime(job.created_at);
    for (let i = 0; i < job.cups.length; i++) {
      const c = job.cups[i];
      const zpl = renderStickerZPL({
        stickerNumber: job.sticker_number,
        orderTime,
        drinkName: c.drinkName,
        toppings: c.toppings,
        ice: c.ice,
        sugar: c.sugar,
        cupIndex: i + 1,
        cupTotal: job.cups.length,
        priceCents: c.priceCents,
      } satisfies CupForZPL);
      await printZPL(zpl);
    }
    await supabase
      .from("print_jobs")
      .update({ status: "printed", printed_at: new Date().toISOString() })
      .eq("id", job.id);
    console.log(`[queue] printed ${job.sticker_number} (${job.cups.length} cups)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const newAttempts = job.attempts + 1;
    await supabase
      .from("print_jobs")
      .update({ status: "failed", attempts: newAttempts, last_error: message })
      .eq("id", job.id);
    console.error(`[queue] failed ${job.sticker_number}: ${message}`);
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
