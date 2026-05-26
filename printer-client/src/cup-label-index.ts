// printer-client/src/cup-label-index.ts
//
// Independent entry point for the Zebra ZD410 cup-label consumer.
// Runs as a SEPARATE launchd job from the ZD411 print_jobs consumer
// (see deploy/com.mandysbubbletea.printer-client-cup-label.plist).
// The two pipelines share the Supabase client + alert endpoint but
// own their own CUPS queues, deviceIds, and timing knobs — one
// crashing or restarting never disturbs the other.

import { config } from "./config";
import { replayOnStart, subscribeCupLabelJobs, startPollFallback } from "./cup-label/queue";
import { startCupLabelHeartbeat, startCupLabelPendingAgeWatch } from "./cup-label/heartbeat";
import { maybeAlert } from "./alert";

async function main() {
  console.log(
    `[cup-label/main] starting cup-label consumer (printer=${config.cupLabelPrinterName}, deviceId=${config.cupLabelDeviceId || "<unset>"})`,
  );
  await replayOnStart();
  const sub = subscribeCupLabelJobs();
  const pollTimer = startPollFallback();
  const hbTimer = startCupLabelHeartbeat();
  const ageTimer = startCupLabelPendingAgeWatch();

  const shutdown = (sig: string) => {
    console.log(`[cup-label/main] ${sig} received, shutting down`);
    clearInterval(hbTimer);
    clearInterval(ageTimer);
    clearInterval(pollTimer);
    sub.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    console.error("[cup-label/main] unhandledRejection:", reason);
    const msg = reason instanceof Error ? reason.message : String(reason);
    maybeAlert(`cup-label unhandledRejection: ${msg}`).catch(() => {
      /* ignore */
    });
  });
  // libusb cleanup occasionally throws "Device is not opened" from
  // inside an async Interface.release() callback that we can't wrap
  // in try/catch upstream. Default Node policy on uncaughtException
  // is process death — for this consumer that means losing the
  // realtime subscription and silently dropping every subsequent
  // cup_label_jobs INSERT. Keep the process alive; the next print's
  // open() refreshes the device handle.
  process.on("uncaughtException", (err) => {
    console.error("[cup-label/main] uncaughtException (kept alive):", err);
    maybeAlert(`cup-label uncaughtException (kept alive): ${err.message}`).catch(() => {
      /* ignore */
    });
  });
}

main().catch((err) => {
  console.error("[cup-label/main] fatal:", err);
  process.exit(1);
});
