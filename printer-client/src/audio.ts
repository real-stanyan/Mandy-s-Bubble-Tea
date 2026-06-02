// printer-client/src/audio.ts
import { spawn } from "node:child_process";
import { config } from "./config";

/**
 * Ensure the macOS default audio output device is the configured
 * speaker. Mandy's Mac mini has a Samsung Soundbar paired via AirPlay;
 * whenever the soundbar comes online macOS auto-selects it as default
 * and our online-order alert plays into a dead device (observed
 * 2026-05-04: customers heard nothing on OL orders all day).
 *
 * Runs once on startup. Silently no-ops if SwitchAudioSource isn't on
 * PATH (e.g. in dev) or the configured device doesn't exist.
 */
export async function ensureAudioOutput(): Promise<void> {
  const target = config.audioOutputDevice;
  if (!target) return;

  try {
    const current = (await runSwitchAudioSource(["-c", "-t", "output"])).trim();
    if (current === target) {
      console.log(`[audio] output already "${target}"`);
      return;
    }
    await runSwitchAudioSource(["-s", target, "-t", "output"]);
    console.log(`[audio] switched output "${current}" -> "${target}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[audio] could not enforce "${target}": ${msg} (continuing)`);
  }
}

function runSwitchAudioSource(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("SwitchAudioSource", args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => (stdout += c.toString()));
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`SwitchAudioSource exit ${code}: ${stderr.trim() || "no stderr"}`));
    });
  });
}
