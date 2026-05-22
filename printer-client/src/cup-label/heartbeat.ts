// printer-client/src/cup-label/heartbeat.ts
//
// ZD410 cup-label twin of ../heartbeat.ts. Shares the printer_heartbeats
// table — keyed on a distinct device_id (config.cupLabelDeviceId) so the
// ZD411 and ZD410 rows coexist without overwriting each other. Mirrors
// the receipt side's 30s upsert + 2min pending-age alert, but queries
// cup_label_jobs and the cup-label printer status getter.

import { supabase } from "../supabase";
import { config } from "../config";
import { getCupLabelPrinterStatus } from "./printer";
import { maybeAlert } from "../alert";

const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const PENDING_AGE_ALERT_MS = 2 * 60 * 1000;

export function startCupLabelHeartbeat(): NodeJS.Timeout {
  const tick = async () => {
    try {
      const [printerStatus, pendingResult] = await Promise.all([
        getCupLabelPrinterStatus(),
        supabase
          .from("cup_label_jobs")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
      ]);
      const pendingCount = pendingResult.count ?? 0;
      await supabase.from("printer_heartbeats").upsert({
        device_id: config.cupLabelDeviceId,
        last_seen_at: new Date().toISOString(),
        printer_status: printerStatus,
        pending_count: pendingCount,
        stale_alert_sent_at: null,
      });
    } catch (err) {
      console.error("[cup-label/heartbeat] tick failed:", err);
    }
  };
  tick();
  return setInterval(tick, HEARTBEAT_INTERVAL_MS);
}

export function startCupLabelPendingAgeWatch(): NodeJS.Timeout {
  const check = async () => {
    try {
      const { data, error } = await supabase
        .from("cup_label_jobs")
        .select("id, created_at, sticker_number, cup_idx")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(1);
      if (error) return;
      const row = (data ?? [])[0];
      if (!row) return;
      const ageMs = Date.now() - new Date(row.created_at).getTime();
      if (ageMs >= PENDING_AGE_ALERT_MS) {
        await maybeAlert(
          `cup-label oldest pending ${row.sticker_number}#${row.cup_idx} aged ${Math.round(ageMs / 1000)}s`,
        );
      }
    } catch (err) {
      console.error("[cup-label/age-watch] failed:", err);
    }
  };
  return setInterval(check, 30 * 1000);
}
