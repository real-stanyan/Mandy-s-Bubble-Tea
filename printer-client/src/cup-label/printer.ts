// printer-client/src/cup-label/printer.ts
//
// Direct USB write to the Zebra ZD410 via libusb (the npm `usb` package).
// Bypasses CUPS entirely — macOS 15+ removed raw-queue support in CUPS
// 2.4, so the lp(1) path can't be created any more without a vendor PPD.
// ZPL printers are designed for raw byte streams; CUPS adds nothing to
// that pipeline. This also means the consumer needs zero drivers, zero
// printer-PPD install, and survives macOS upgrades.
//
// The ZD411 path (../printer.ts) still uses lp(1) because its CUPS queue
// was created on an older macOS and is grandfathered in. Not touching it
// here per the "leave ZD411 alone" requirement.

import { findByIds, type Device, type OutEndpoint } from "usb";
import { config } from "../config";

const ZEBRA_VENDOR_ID = 0x0a5f;

function zd410ProductId(): number {
  const raw = process.env.CUP_LABEL_USB_PRODUCT_ID;
  if (raw) {
    const n = raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }
  // ZD410-300dpi default observed on Stan's macbook (serial 50J214700502).
  // Override via CUP_LABEL_USB_PRODUCT_ID if a different SKU lands later.
  return 0x011e;
}

function findZD410(): Device | undefined {
  return findByIds(ZEBRA_VENDOR_ID, zd410ProductId());
}

/**
 * Send a ZPL II string to the ZD410 over USB.
 *
 * Each call opens the device → claims interface 0 → finds the bulk OUT
 * endpoint → writes the buffer → releases → closes. Per-call open/close
 * costs ~50ms but keeps the device free for other tools (Zebra Setup
 * Utilities, etc.) between prints.
 *
 * On macOS the kernel auto-attaches a generic USB printer class driver.
 * We try to detach it before claim; if detach isn't supported we still
 * attempt claim — recent macOS versions allow claim without explicit
 * detach as long as no CUPS scheduler holds the device.
 */
export function printCupLabelZPL(zpl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const dev = findZD410();
    if (!dev) {
      reject(
        new Error(
          `ZD410 USB device not found (vendor=0x${ZEBRA_VENDOR_ID.toString(16)}, product=0x${zd410ProductId().toString(16)})`,
        ),
      );
      return;
    }

    try {
      dev.open();
    } catch (e) {
      reject(new Error(`USB open failed: ${e instanceof Error ? e.message : String(e)}`));
      return;
    }

    const iface = dev.interface(0);

    try {
      if (typeof iface.isKernelDriverActive === "function" && iface.isKernelDriverActive()) {
        iface.detachKernelDriver();
      }
    } catch {
      // Not all macOS / libusb combinations support kernel-driver detach.
      // Fall through to claim — most modern macOS releases allow the
      // claim without explicit detach.
    }

    try {
      iface.claim();
    } catch (e) {
      try {
        dev.close();
      } catch {
        /* ignore */
      }
      reject(new Error(`USB claim failed: ${e instanceof Error ? e.message : String(e)}`));
      return;
    }

    const outEp = iface.endpoints.find((ep) => ep.direction === "out") as
      | OutEndpoint
      | undefined;
    if (!outEp) {
      iface.release(true, () => {
        try {
          dev.close();
        } catch {
          /* ignore */
        }
        reject(new Error("no OUT endpoint on ZD410 interface 0"));
      });
      return;
    }

    let settled = false;
    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      iface.release(true, () => {
        try {
          dev.close();
        } catch {
          /* ignore */
        }
        if (err) reject(err);
        else resolve();
      });
    };

    const timer = setTimeout(() => {
      settle(new Error(`USB transfer timeout after ${config.cupLabelLpTimeoutMs}ms`));
    }, config.cupLabelLpTimeoutMs);

    outEp.timeout = config.cupLabelLpTimeoutMs;

    // Chunked transfer. Large ^GFA payloads (84+ KB hex raster) overrun
    // the ZD410's internal USB receive buffer when sent as one transfer
    // — the host-side libusb transfer completes (bytes accepted onto the
    // USB endpoint) but the printer's parser drops trailing hex chars,
    // leaving the printer to fire a blank label. Slicing the buffer into
    // ~16KB chunks with a ~60ms pause between each gives the parser time
    // to consume each block before the next arrives. The full-buffer
    // path takes ~300ms; the chunked path takes ~400ms for a 84KB label
    // — a barely-perceptible per-cup penalty in exchange for reliability.
    const buf = Buffer.from(zpl, "utf8");
    const CHUNK = 16 * 1024;
    const CHUNK_GAP_MS = 60;

    const sendChunk = (offset: number) => {
      if (settled) return;
      if (offset >= buf.length) {
        settle();
        return;
      }
      const slice = buf.subarray(offset, Math.min(offset + CHUNK, buf.length));
      outEp.transfer(slice, (err: Error | undefined) => {
        if (err) {
          settle(new Error(`USB transfer failed at offset ${offset}: ${err.message}`));
          return;
        }
        // Pause between chunks to let the ZD410 drain its receive buffer.
        // Last chunk doesn't need the pause — settle immediately.
        const next = offset + slice.length;
        if (next >= buf.length) settle();
        else setTimeout(() => sendChunk(next), CHUNK_GAP_MS);
      });
    };

    sendChunk(0);
  });
}

/**
 * Reachability check. libusb can detect device presence but a ZD410
 * doesn't expose a "busy/idle" flag without sending vendor SGD/SDP
 * queries. So we collapse to two states — 'idle' if the device is
 * present on the bus, 'offline' if it isn't. A jammed printer will
 * surface as a transfer timeout instead.
 */
export async function getCupLabelPrinterStatus(): Promise<
  "idle" | "printing" | "offline" | "unknown"
> {
  const dev = findZD410();
  if (!dev) return "offline";
  return "idle";
}
