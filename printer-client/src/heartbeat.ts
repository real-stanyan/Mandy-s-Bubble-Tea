// printer-client/src/heartbeat.ts
import { supabase } from "./supabase";
import { config } from "./config";
import { getPrinterStatus } from "./printer";

const HEARTBEAT_INTERVAL_MS = 30 * 1000;

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
