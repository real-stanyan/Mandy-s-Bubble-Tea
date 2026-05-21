// printer-client/scripts/test-print-zd410.ts
//
// Standalone USB ping for the ZD410. Bypasses Supabase / Realtime /
// cup_label_jobs entirely — opens the device via libusb and writes a
// 50×80mm "Hello ZD410" ZPL directly. Used to verify the USB transport
// (vendor/product IDs, libusb permissions, paper alignment) without
// any consumer running.
//
// Usage:
//   cd ~/Github/mandys_bubble_tea/printer-client
//   npx tsx scripts/test-print-zd410.ts

import { printCupLabelZPL } from "../src/cup-label/printer";

const zpl = [
  "^XA",
  "^PW590",
  "^LL945",
  "^FO40,40^A0N,60,60^FDHello ZD410^FS",
  "^FO40,120^A0N,40,40^FD50x80 USB direct write^FS",
  "^FO40,180^A0N,40,40^FDvia libusb (no CUPS)^FS",
  "^FO40,260^A0N,32,32^FD" + new Date().toISOString() + "^FS",
  "^XZ",
].join("\n");

async function main() {
  console.log("[test-zd410] sending Hello ZPL to ZD410 over USB…");
  await printCupLabelZPL(zpl);
  console.log("[test-zd410] OK — ZD410 should have fired one label");
}

main().catch((err) => {
  console.error("[test-zd410] FAILED:", err.message);
  console.error("");
  console.error("Common causes:");
  console.error("  - ZD410 not powered on / USB cable not connected");
  console.error("  - Different USB product ID — set CUP_LABEL_USB_PRODUCT_ID=0x???");
  console.error("    (find via: system_profiler SPUSBDataType | grep -A 10 Zebra)");
  console.error("  - macOS holding the device in another process — close Zebra Setup Utilities");
  console.error("    or run: sudo killall cups-browsed 2>/dev/null; sudo killall PrinterProxy");
  process.exit(1);
});
