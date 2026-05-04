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
  // has a Samsung Soundbar paired via AirPlay; whenever the soundbar
  // wakes up macOS auto-selects it as default and the new-online-order
  // alert plays into a dead device. Set to empty string to disable.
  audioOutputDevice: process.env.AUDIO_OUTPUT_DEVICE ?? "Mac mini Speakers",
};
