// printer-client/src/ui/server.ts
import express from "express";
import path from "node:path";
import { supabase } from "../supabase";
import { getPrinterStatus } from "../printer";
import { config } from "../config";

export function startUi(): void {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/api/status", async (_req, res) => {
    const [printerStatus, pendingResult] = await Promise.all([
      getPrinterStatus(),
      supabase.from("print_jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    res.json({
      printerStatus,
      pendingCount: pendingResult.count ?? 0,
      deviceId: config.deviceId,
    });
  });

  app.get("/api/jobs", async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const { data, error } = await supabase
      .from("print_jobs")
      .select("id, sticker_number, source, status, cups, created_at, printed_at, attempts, last_error")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ jobs: data ?? [] });
  });

  app.post("/api/jobs/:id/reprint", async (req, res) => {
    const id = req.params.id;
    const { data: orig, error: origErr } = await supabase
      .from("print_jobs")
      .select("*")
      .eq("id", id)
      .single();
    if (origErr || !orig) return res.status(404).json({ error: "not found" });
    const synthetic = `reprint:${orig.square_order_id}:${new Date().toISOString()}`;
    const { data: cloned, error: cloneErr } = await supabase
      .from("print_jobs")
      .insert({
        square_order_id: synthetic,
        source: orig.source,
        sticker_number: orig.sticker_number,
        order_total_cents: orig.order_total_cents,
        cups: orig.cups,
        status: "pending",
      })
      .select()
      .single();
    if (cloneErr) return res.status(500).json({ error: cloneErr.message });
    res.json({ ok: true, clonedId: cloned.id });
  });

  app.post("/api/test-print", async (_req, res) => {
    const { renderStickerZPL } = await import("../zpl");
    const { printZPL } = await import("../printer");
    const zpl = renderStickerZPL({
      stickerNumber: "TEST",
      orderTime: new Date().toLocaleTimeString("en-AU", { timeZone: "Australia/Brisbane", hour: "2-digit", minute: "2-digit", hour12: false }),
      drinkName: "Test Print",
      toppings: ["Pearls"],
      ice: "Less Ice",
      sugar: "Half Sugar",
      cupIndex: 1,
      cupTotal: 1,
      priceCents: 0,
    });
    try {
      await printZPL(zpl);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.listen(config.localUiPort, "127.0.0.1", () => {
    console.log(`[ui] listening on http://localhost:${config.localUiPort}`);
  });
}
