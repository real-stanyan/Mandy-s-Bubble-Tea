// printer-client/src/index.ts
import { replayOnStart, subscribePrintJobs, startPollFallback } from "./queue";
import { startHeartbeat, startPendingAgeWatch } from "./heartbeat";
import { startUi } from "./ui/server";
import { maybeAlert } from "./alert";

async function main() {
  console.log("[main] starting Mandy's printer client");
  await replayOnStart();
  const sub = subscribePrintJobs();
  const pollTimer = startPollFallback();
  const hbTimer = startHeartbeat();
  const ageTimer = startPendingAgeWatch();
  startUi();

  const shutdown = (sig: string) => {
    console.log(`[main] ${sig} received, shutting down`);
    clearInterval(hbTimer);
    clearInterval(ageTimer);
    clearInterval(pollTimer);
    sub.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Last-chance catch-alls. An unhandled rejection in async code
  // path would otherwise crash the process silently. We let launchd
  // restart us, but first send an alert so the owner knows.
  process.on("unhandledRejection", (reason) => {
    console.error("[main] unhandledRejection:", reason);
    const msg = reason instanceof Error ? reason.message : String(reason);
    maybeAlert(`unhandledRejection: ${msg}`).catch(() => { /* ignore */ });
  });
  process.on("uncaughtException", (err) => {
    console.error("[main] uncaughtException:", err);
    maybeAlert(`uncaughtException: ${err.message}`)
      .catch(() => { /* ignore */ })
      .finally(() => process.exit(1));
  });
}

main().catch((err) => {
  console.error("[main] fatal:", err);
  process.exit(1);
});
