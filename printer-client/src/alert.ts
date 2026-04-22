// printer-client/src/alert.ts
import { config } from "./config";

// Dedup: don't send the same error within 5 minutes.
const recent: Map<string, number> = new Map();
const DEDUP_MS = 5 * 60 * 1000;

export async function maybeAlert(message: string): Promise<void> {
  if (!config.adminAlertEndpoint || !config.printerAlertToken) {
    console.warn("[alert] endpoint or token missing, skipping:", message);
    return;
  }
  const now = Date.now();
  const last = recent.get(message) ?? 0;
  if (now - last < DEDUP_MS) return;
  recent.set(message, now);
  try {
    const res = await fetch(config.adminAlertEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.printerAlertToken}`,
      },
      body: JSON.stringify({
        deviceId: config.deviceId,
        message,
        at: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      console.error(`[alert] endpoint returned ${res.status}`);
    }
  } catch (err) {
    console.error("[alert] POST failed:", err);
  }
}
