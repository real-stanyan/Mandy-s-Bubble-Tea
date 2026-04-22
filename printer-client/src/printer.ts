// printer-client/src/printer.ts
import { spawn } from "node:child_process";
import { config } from "./config";

/**
 * Send a ZPL string to the Zebra ZD411 via CUPS (`lp -o raw`).
 * Resolves on lp exit 0, rejects on non-zero or spawn error.
 */
export function printZPL(zpl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const lp = spawn("lp", ["-d", config.printerName, "-o", "raw"]);
    let stderr = "";
    lp.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    lp.on("error", reject);
    lp.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`lp exit ${code}: ${stderr.trim() || "no stderr"}`));
    });
    lp.stdin.end(zpl);
  });
}

/**
 * Query CUPS for the printer status. Returns 'idle', 'printing',
 * 'offline' (disabled / stopped / not present), or 'unknown'.
 */
export async function getPrinterStatus(): Promise<"idle" | "printing" | "offline" | "unknown"> {
  return new Promise((resolve) => {
    const lpstat = spawn("lpstat", ["-p", config.printerName]);
    let stdout = "";
    lpstat.stdout.on("data", (c) => (stdout += c.toString()));
    lpstat.on("error", () => resolve("offline"));
    lpstat.on("exit", () => {
      const s = stdout.toLowerCase();
      if (s.includes("is idle")) resolve("idle");
      else if (s.includes("printing") || s.includes("now printing")) resolve("printing");
      else if (s.includes("disabled") || s.includes("stopped")) resolve("offline");
      else resolve("unknown");
    });
  });
}
