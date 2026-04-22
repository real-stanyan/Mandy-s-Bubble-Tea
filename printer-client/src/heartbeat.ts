// printer-client/src/heartbeat.ts
import { supabase } from "./supabase";
import { config } from "./config";
import { getPrinterStatus } from "./printer";
import { maybeAlert } from "./alert";

const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const PENDING_AGE_ALERT_MS = 2 * 60 * 1000;

export function startHeartbeat(): NodeJS.Timeout {
  const tick = async () => {
    try {
      const [printerStatus, pendingResult] = await Promise.all([
        getPrinterStatus(),
        supabase.from("print_jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);
      const pendingCount = pendingResult.count ?? 0;
      await supabase.from("printer_heartbeats").upsert({
        device_id: config.deviceId,
        last_seen_at: new Date().toISOString(),
        printer_status: printerStatus,
        pending_count: pendingCount,
      });
    } catch (err) {
      console.error("[heartbeat] tick failed:", err);
    }
  };
  tick();
  return setInterval(tick, HEARTBEAT_INTERVAL_MS);
}

export function startPendingAgeWatch(): NodeJS.Timeout {
  const check = async () => {
    try {
      const { data, error } = await supabase
        .from("print_jobs")
        .select("id, created_at, sticker_number")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(1);
      if (error) return;
      const row = (data ?? [])[0];
      if (!row) return;
      const ageMs = Date.now() - new Date(row.created_at).getTime();
      if (ageMs >= PENDING_AGE_ALERT_MS) {
        await maybeAlert(
          `oldest pending ${row.sticker_number} aged ${Math.round(ageMs / 1000)}s`,
        );
      }
    } catch (err) {
      console.error("[age-watch] failed:", err);
    }
  };
  return setInterval(check, 30 * 1000);
}
