// printer-client/src/cup-label/online-order-alert.ts
//
// Plays an audible alert when an online order (sticker_number starting
// "OL") lands in the print_jobs table. Subscribes to print_jobs INSERT
// via Supabase Realtime and shells out to `say` + `afplay -v 2` for
// software-level loudness — TYPE C / HDMI digital outputs ignore
// osascript volume, but afplay's -v multiplier stacks on top of the
// device's own level and is the only knob we control from software.
//
// Co-tenant with the ZD410 cup-label consumer (one launchd plist drives
// both). The ZD411 receipts plist is retired, so this is the sole
// listener for OL print_jobs and there is no double-play risk.
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../supabase";

type PrintJobRow = {
  sticker_number: string;
  status: string;
};

const ALERT_FILE = join(tmpdir(), "mandy-online-order-alert.aiff");
const AFPLAY_GAIN = "2"; // 200% software-side amplification

let alertFileReady: Promise<void> | null = null;

function renderAlertFile(): Promise<void> {
  return new Promise<void>((resolve) => {
    const proc = spawn(
      "say",
      ["-v", "Samantha", "-r", "180", "-o", ALERT_FILE, "new order"],
      { stdio: "ignore" },
    );
    proc.on("exit", () => resolve());
    proc.on("error", () => resolve());
  });
}

async function ensureAlertFile(): Promise<void> {
  if (!alertFileReady) alertFileReady = renderAlertFile();
  return alertFileReady;
}

export async function playOnlineOrderAlert(): Promise<void> {
  try {
    await ensureAlertFile();
    spawn("afplay", ["-v", AFPLAY_GAIN, ALERT_FILE], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } catch {
    /* sound failure must never block anything else */
  }
}

export function subscribeOnlineOrderAlerts(): { close: () => void } {
  let channel: RealtimeChannel | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let closed = false;

  const connect = () => {
    if (closed) return;
    channel = supabase
      .channel("online-order-alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "print_jobs" },
        (payload) => {
          const row = payload.new as PrintJobRow;
          if (!row?.sticker_number?.startsWith("OL")) return;
          if (row.status !== "pending") return;
          playOnlineOrderAlert().catch(() => {
            /* logged inside */
          });
        },
      )
      .subscribe((status) => {
        console.log(`[online-order-alert] realtime status: ${status}`);
        if (status === "SUBSCRIBED") return;
        if (closed) return;
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
