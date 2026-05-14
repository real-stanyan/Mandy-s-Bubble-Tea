// printer-client/src/cup-label/printer.ts
import { spawn } from "node:child_process";
import { config } from "../config";

/**
 * Send a ZPL string to the Zebra ZD410 cup-label printer via CUPS
 * (`lp -d <cupLabelPrinterName> -o raw`). Independent from the ZD411
 * `printZPL` in ../printer.ts so the two CUPS queues can fail/recover
 * independently — see the "two independent launchd jobs" decision in
 * the spec.
 *
 * Resolves on `lp` exit 0, rejects on non-zero, spawn error, or timeout.
 * The timeout guards against CUPS hanging when the ZD410 is offline or
 * jammed; without it a single stuck `lp` would freeze the cup-label
 * queue forever.
 */
export function printCupLabelZPL(zpl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const lp = spawn("lp", ["-d", config.cupLabelPrinterName, "-o", "raw"]);
    let stderr = "";
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      try {
        lp.kill("SIGKILL");
      } catch {
        // ignore
      }
      done(() => reject(new Error(`lp timeout after ${config.cupLabelLpTimeoutMs}ms`)));
    }, config.cupLabelLpTimeoutMs);

    lp.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    lp.on("error", (err) => done(() => reject(err)));
    lp.on("exit", (code) => {
      if (code === 0) done(() => resolve());
      else done(() => reject(new Error(`lp exit ${code}: ${stderr.trim() || "no stderr"}`)));
    });
    lp.stdin.end(zpl);
  });
}

/**
 * Query CUPS for the cup-label printer status. Returns 'idle',
 * 'printing', 'offline' (disabled / stopped / not present), or 'unknown'.
 * Bounded by a 5s timeout so a stuck lpstat can't block the tick.
 */
export async function getCupLabelPrinterStatus(): Promise<
  "idle" | "printing" | "offline" | "unknown"
> {
  return new Promise((resolve) => {
    const lpstat = spawn("lpstat", ["-p", config.cupLabelPrinterName]);
    let stdout = "";
    let settled = false;
    const done = (value: "idle" | "printing" | "offline" | "unknown") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try {
        lpstat.kill("SIGKILL");
      } catch {
        // ignore
      }
      done("unknown");
    }, 5000);

    lpstat.stdout.on("data", (c) => (stdout += c.toString()));
    lpstat.on("error", () => done("offline"));
    lpstat.on("exit", () => {
      const s = stdout.toLowerCase();
      if (s.includes("is idle")) done("idle");
      else if (s.includes("printing") || s.includes("now printing")) done("printing");
      else if (s.includes("disabled") || s.includes("stopped")) done("offline");
      else done("unknown");
    });
  });
}
