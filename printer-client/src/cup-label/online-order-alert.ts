// printer-client/src/cup-label/online-order-alert.ts
//
// Plays an audible alert when an online order ("OL…") is printed. Shells
// out to `say` (pre-rendered once) + `afplay -v 2` for software-level
// loudness — TYPE C / HDMI digital outputs ignore osascript volume, but
// afplay's -v multiplier stacks on top of the device's own level and is
// the only knob we control from software.
//
// The cue is driven from the cup-label queue's print flow
// (see queue.ts: maybePlayOrderAlert), NOT a standalone Realtime
// channel. A dedicated channel had no poll fallback, so when Supabase
// Realtime flapped (observed 2026-05-26: SUBSCRIBED<->CLOSED every ~2s)
// it missed the INSERT and the store went silent while labels kept
// printing off the queue's catch-up poll. Riding the queue means the
// cue inherits the same realtime+poll delivery the labels already have.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureAudioOutput } from "../audio";

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
  if (alertFileReady) {
    await alertFileReady;
    // /tmp is swept by macOS after ~3 days and `say` can fail silently
    // (renderAlertFile resolves on error too). A long-running consumer
    // would then play a missing file forever, so re-render if the cached
    // promise resolved but the file is gone.
    if (existsSync(ALERT_FILE)) return;
    alertFileReady = null;
  }
  alertFileReady = renderAlertFile();
  return alertFileReady;
}

export async function playOnlineOrderAlert(): Promise<void> {
  try {
    // Re-assert the output device on EVERY alert, not just at startup.
    // The Soundbar is paired over AirPlay; each time it drops and
    // re-attaches macOS silently re-selects it as default and the prior
    // default can be a dead device (audio.ts header). A once-on-startup
    // enforcement drifts after any mid-session reconnect.
    await ensureAudioOutput();
    await ensureAlertFile();
    spawn("afplay", ["-v", AFPLAY_GAIN, ALERT_FILE], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } catch {
    /* sound failure must never block anything else */
  }
}
