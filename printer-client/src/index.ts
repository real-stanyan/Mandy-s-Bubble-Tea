// printer-client/src/index.ts
import { replayOnStart, subscribePrintJobs } from "./queue";
import { startHeartbeat, startPendingAgeWatch } from "./heartbeat";

async function main() {
  console.log("[main] starting Mandy's printer client");
  await replayOnStart();
  const channel = subscribePrintJobs();
  const hbTimer = startHeartbeat();
  const ageTimer = startPendingAgeWatch();

  const shutdown = (sig: string) => {
    console.log(`[main] ${sig} received, shutting down`);
    clearInterval(hbTimer);
    clearInterval(ageTimer);
    channel.unsubscribe();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[main] fatal:", err);
  process.exit(1);
});
