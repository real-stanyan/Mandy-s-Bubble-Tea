// printer-client/src/cup-label/queue.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks need to be hoisted via vi.mock factories; defer importing the
// module-under-test until after mocks are wired so closure references
// stay consistent.

vi.mock("../supabase", () => {
  const updateCalls: Array<{ patch: Record<string, unknown>; chain: string[] }> = [];
  const builder = (table: string) => {
    const chain: string[] = [table];
    const proxy: Record<string, (..._args: unknown[]) => unknown> = {};
    let lastPatch: Record<string, unknown> | null = null;
    const methods = ["update", "select", "eq", "in", "lt", "order", "limit"];
    for (const m of methods) {
      proxy[m] = (...args: unknown[]) => {
        if (m === "update") lastPatch = args[0] as Record<string, unknown>;
        chain.push(`${m}(${JSON.stringify(args)})`);
        return proxy;
      };
    }
    proxy.maybeSingle = async () => {
      if (lastPatch) updateCalls.push({ patch: lastPatch, chain: [...chain] });
      return { data: (globalThis as Record<string, unknown>).__cupLabelClaimRow ?? null, error: null };
    };
    proxy.then = (resolve: (v: unknown) => unknown) => {
      if (lastPatch) updateCalls.push({ patch: lastPatch, chain: [...chain] });
      return Promise.resolve({ data: null, error: null }).then(resolve);
    };
    return proxy;
  };
  return {
    supabase: {
      from: vi.fn((table: string) => builder(table)),
      __updateCalls: updateCalls,
    },
  };
});

vi.mock("./printer", () => ({
  printCupLabelZPL: vi.fn(),
  getCupLabelPrinterStatus: vi.fn(),
}));

vi.mock("./storage", () => ({
  downloadRasterZPL: vi.fn(),
}));

vi.mock("../alert", () => ({
  maybeAlert: vi.fn(),
}));

vi.mock("../config", () => ({
  config: {
    cupLabelPrinterName: "Zebra_ZD410",
    cupLabelDeviceId: "test-device",
    cupLabelLpTimeoutMs: 15000,
    cupLabelPollFallbackMs: 15000,
    cupLabelStaleWindowMs: 2 * 60 * 60 * 1000,
    cupLabelStorageBucket: "doodles",
  },
}));

import { handleJob } from "./queue";
import { supabase } from "../supabase";
import { printCupLabelZPL, getCupLabelPrinterStatus } from "./printer";
import { downloadRasterZPL } from "./storage";
import { maybeAlert } from "../alert";

type SupabaseMock = typeof supabase & {
  __updateCalls: Array<{ patch: Record<string, unknown>; chain: string[] }>;
};

const baseRow = {
  id: "00000000-0000-0000-0000-000000000001",
  square_order_id: "sq_order_1",
  line_id: "line_1",
  cup_idx: 0,
  sticker_number: "OL999",
  drink_name: "Blueberry Slushy",
  modifiers_text: "Pearls -> L.Ice -> 50%S",
  doodle_source: "user" as const,
  doodle_pool_key: null,
  raster_path: "sq_order_1/line_1_0.zpl",
  status: "pending" as const,
  attempts: 0,
  last_error: null,
  printer_token: null,
  created_at: new Date().toISOString(),
  printed_at: null,
};

describe("cup-label queue.handleJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (supabase as SupabaseMock).__updateCalls.length = 0;
    (globalThis as Record<string, unknown>).__cupLabelClaimRow = null;
  });

  it("happy path: claim → status check → download → print → mark printed", async () => {
    (globalThis as Record<string, unknown>).__cupLabelClaimRow = { ...baseRow, status: "printing", attempts: 1 };
    vi.mocked(getCupLabelPrinterStatus).mockResolvedValue("idle");
    vi.mocked(downloadRasterZPL).mockResolvedValue("^XA^FO50,50^A0N,50,50^FDtest^FS^XZ");
    vi.mocked(printCupLabelZPL).mockResolvedValue();

    await handleJob(baseRow);

    expect(downloadRasterZPL).toHaveBeenCalledWith("sq_order_1/line_1_0.zpl");
    expect(printCupLabelZPL).toHaveBeenCalledWith("^XA^FO50,50^A0N,50,50^FDtest^FS^XZ");
    expect(maybeAlert).not.toHaveBeenCalled();

    const patches = (supabase as SupabaseMock).__updateCalls.map((c) => c.patch);
    const claimPatch = patches.find((p) => p.status === "printing");
    expect(claimPatch).toBeDefined();
    const successPatch = patches.find((p) => p.status === "printed");
    expect(successPatch).toBeDefined();
    expect(successPatch?.printed_at).toBeTypeOf("string");
    expect(successPatch?.printer_token).toBeNull();
  });

  it("skips when claim affects zero rows (another consumer won the race)", async () => {
    (globalThis as Record<string, unknown>).__cupLabelClaimRow = null;

    await handleJob(baseRow);

    expect(getCupLabelPrinterStatus).not.toHaveBeenCalled();
    expect(downloadRasterZPL).not.toHaveBeenCalled();
    expect(printCupLabelZPL).not.toHaveBeenCalled();
  });

  it("when CUPS printer offline: marks failed + alerts, never downloads or prints", async () => {
    (globalThis as Record<string, unknown>).__cupLabelClaimRow = { ...baseRow, status: "printing", attempts: 1 };
    vi.mocked(getCupLabelPrinterStatus).mockResolvedValue("offline");

    await handleJob(baseRow);

    expect(downloadRasterZPL).not.toHaveBeenCalled();
    expect(printCupLabelZPL).not.toHaveBeenCalled();
    expect(maybeAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(maybeAlert).mock.calls[0][0]).toContain("offline");

    const patches = (supabase as SupabaseMock).__updateCalls.map((c) => c.patch);
    const failPatch = patches.find((p) => p.status === "failed");
    expect(failPatch).toBeDefined();
    expect(failPatch?.last_error).toContain("printer offline");
  });

  it("on storage download error: marks failed with the error message", async () => {
    (globalThis as Record<string, unknown>).__cupLabelClaimRow = { ...baseRow, status: "printing", attempts: 1 };
    vi.mocked(getCupLabelPrinterStatus).mockResolvedValue("idle");
    vi.mocked(downloadRasterZPL).mockRejectedValue(new Error("storage download foo.zpl failed: not found"));

    await handleJob(baseRow);

    expect(printCupLabelZPL).not.toHaveBeenCalled();
    const patches = (supabase as SupabaseMock).__updateCalls.map((c) => c.patch);
    const failPatch = patches.find((p) => p.status === "failed");
    expect(failPatch?.last_error).toContain("storage download");
  });

  it("alerts on the 3rd consecutive print failure (attempts >= 3)", async () => {
    (globalThis as Record<string, unknown>).__cupLabelClaimRow = { ...baseRow, status: "printing", attempts: 3 };
    vi.mocked(getCupLabelPrinterStatus).mockResolvedValue("idle");
    vi.mocked(downloadRasterZPL).mockResolvedValue("^XA^XZ");
    vi.mocked(printCupLabelZPL).mockRejectedValue(new Error("lp exit 1: paper out"));

    await handleJob(baseRow);

    expect(maybeAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(maybeAlert).mock.calls[0][0]).toContain("3x");
  });
});
