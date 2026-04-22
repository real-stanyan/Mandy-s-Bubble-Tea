// printer-client/scripts/test-print.ts
import { printZPL } from "../src/printer";
import { renderStickerZPL } from "../src/zpl";

async function main() {
  const zpl = renderStickerZPL({
    stickerNumber: "TEST",
    orderTime: new Date().toLocaleTimeString("en-AU", {
      timeZone: "Australia/Brisbane",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    drinkName: "Test Print",
    toppings: ["Pearls"],
    ice: "Less Ice",
    sugar: "Half Sugar",
    cupIndex: 1,
    cupTotal: 1,
    priceCents: 0,
  });
  console.log(zpl);
  await printZPL(zpl);
  console.log("[test-print] sent to", process.env.PRINTER_NAME ?? "Zebra_ZD411");
}

main().catch((err) => {
  console.error("[test-print] failed:", err);
  process.exit(1);
});
