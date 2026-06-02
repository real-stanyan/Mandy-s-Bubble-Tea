// printer-client/scripts/calibrate-zd410.ts
//
// Run a one-time media calibration on the ZD410. Sends Zebra's ~JC
// immediate command — the printer feeds 2-3 labels while reading the
// gap-sensor to learn the label length + gap position. After calibration
// a normal ^XA…^XZ ZPL prints exactly one label per command instead of
// continuous-feeding to the next gap.
//
// Run this once after loading a new label roll, after changing label
// SKU/size, or any time prints come out multi-feed (the most common
// symptom of un-calibrated media).
//
// Usage:
//   cd ~/Github/mandys_bubble_tea/printer-client
//   npx tsx scripts/calibrate-zd410.ts

import { printCupLabelZPL } from "../src/cup-label/printer";

async function main() {
  console.log("[calibrate-zd410] sending ~JC (force media calibration)…");
  console.log("[calibrate-zd410] ZD410 will feed 2-3 labels while it reads the gap sensor.");
  await printCupLabelZPL("~JC\n");
  console.log("[calibrate-zd410] OK — wait until the printer stops feeding before next print.");
}

main().catch((err) => {
  console.error("[calibrate-zd410] FAILED:", err.message);
  process.exit(1);
});
