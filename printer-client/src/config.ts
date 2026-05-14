// printer-client/src/config.ts
import { config as loadEnv } from "dotenv";
import path from "path";

loadEnv({ path: path.resolve(__dirname, "../.env.local") });
loadEnv();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  printerName: process.env.PRINTER_NAME ?? "Zebra_ZD411",
  // Required so two machines can't silently collide on the same
  // device_id and each print every job. See DEVICE_ID_NOTE in README.
  deviceId: requireEnv("DEVICE_ID"),
  adminAlertEndpoint: process.env.ADMIN_ALERT_ENDPOINT,
  printerAlertToken: process.env.PRINTER_ALERT_TOKEN,
  localUiPort: Number(process.env.LOCAL_UI_PORT ?? "3001"),
  // How long `lp` is allowed to run before we kill it and mark the
  // job failed. Guards against CUPS hanging when the printer is
  // offline or jammed.
  lpTimeoutMs: Number(process.env.LP_TIMEOUT_MS ?? "15000"),
  // Jobs older than this on startup are marked 'stale' instead of
  // replayed. Wider window = fewer dropped jobs after a long outage.
  // 2h covers a lunch-service-length power or network outage so we
  // don't silently drop stickers for orders the POS already accepted.
  staleWindowMs: Number(process.env.STALE_WINDOW_MS ?? String(2 * 60 * 60 * 1000)),
  // Fallback poll cadence. The primary delivery channel is Supabase
  // Realtime; this poll covers the gap if the socket silently drops
  // an INSERT event without changing channel status (observed ~2-3%
  // of jobs in production). 8s keeps worst-case customer wait
  // basically invisible while costing ~7 Supabase calls/min on a
  // table that's empty 99% of the time.
  pollFallbackMs: Number(process.env.POLL_FALLBACK_MS ?? "8000"),
  // macOS audio output device to enforce on startup. Mandy's Mac mini
  // is paired with a Samsung Soundbar over AirPlay — owner wants the
  // OL-arrival alert played there because the store is loud. macOS
  // sometimes drops the soundbar from default selection (TYPE C
  // dongle, Mac mini Speakers, or whichever was last connected wins);
  // this nudges it back on every startup. If the soundbar is offline
  // the switch silently fails and the alert simply doesn't play —
  // owner accepts that trade-off (keep soundbar powered on).
  // Set to empty string to disable enforcement entirely.
  audioOutputDevice: process.env.AUDIO_OUTPUT_DEVICE ?? "[ AV ] Samsung Soundbar T4-Series",

  // ZD410 cup-label consumer — runs as a separate launchd job alongside
  // the ZD411 print_jobs consumer. Shares supabase + alert endpoint, but
  // owns its own CUPS queue, deviceId, and timing knobs so the two
  // pipelines stay isolated (one crashing/restarting doesn't disturb
  // the other).
  cupLabelPrinterName: process.env.CUP_LABEL_PRINTER_NAME ?? "Zebra_ZD410",
  cupLabelDeviceId: process.env.CUP_LABEL_DEVICE_ID ?? "",
  cupLabelLpTimeoutMs: Number(process.env.CUP_LABEL_LP_TIMEOUT_MS ?? "15000"),
  // Cup-label jobs are time-insensitive (doodle is a keepsake feature),
  // so the poll fallback can be slower than the ZD411 hot path.
  cupLabelPollFallbackMs: Number(process.env.CUP_LABEL_POLL_FALLBACK_MS ?? "15000"),
  // Same 2h default as print_jobs — jobs older than this on startup are
  // marked 'failed' (cup_label_jobs has no 'stale' status, only
  // pending/printing/printed/failed).
  cupLabelStaleWindowMs: Number(
    process.env.CUP_LABEL_STALE_WINDOW_MS ?? String(2 * 60 * 60 * 1000),
  ),
  // Supabase Storage bucket where the rendered ZPL II files live —
  // path is the `raster_path` column on cup_label_jobs (e.g.
  // `<orderId>/<lineId>_<cupIdx>.zpl`).
  cupLabelStorageBucket: process.env.CUP_LABEL_STORAGE_BUCKET ?? "doodles",
};
