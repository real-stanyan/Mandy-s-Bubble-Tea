// printer-client/src/ui/server.ts
import express from "express";
import path from "node:path";
import { supabase } from "../supabase";
import { getPrinterStatus } from "../printer";
import { config } from "../config";

// In-memory cache for Labelary-rendered previews. Cups are immutable once
// a job is inserted, so key on (jobId, cupIndex). Bounded informally by
// the jobs list only returning the last ~100 entries — no explicit LRU
// needed until the UI paginates history.
const previewCache = new Map<string, Buffer>();

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

  app.get("/api/jobs/:id/preview.png", async (req, res) => {
    const id = req.params.id;
    const cupIndex = Math.max(1, Number(req.query.cup ?? 1));
    const cacheKey = `${id}:${cupIndex}`;
    const cached = previewCache.get(cacheKey);
    if (cached) {
      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "public, max-age=86400");
      res.send(cached);
      return;
    }

    const { data, error } = await supabase
      .from("print_jobs")
      .select("cups, sticker_number, created_at")
      .eq("id", id)
      .single();
    if (error || !data) return res.status(404).send("not found");
    const cups = (data.cups as Array<Record<string, unknown>>) ?? [];
    if (cupIndex < 1 || cupIndex > cups.length) {
      return res.status(404).send("cup out of range");
    }
    const cup = cups[cupIndex - 1];
    const orderTime = new Date(data.created_at as string).toLocaleTimeString("en-AU", {
      timeZone: "Australia/Brisbane", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const { renderStickerZPL } = await import("../zpl");
    const zpl = renderStickerZPL({
      stickerNumber: String(data.sticker_number ?? ""),
      orderTime,
      drinkName: String(cup.drinkName ?? "Drink"),
      toppings: (cup.toppings as string[]) ?? [],
      ice: (cup.ice as string | null) ?? null,
      sugar: (cup.sugar as string | null) ?? null,
      cupIndex,
      cupTotal: cups.length,
      priceCents: Number(cup.priceCents ?? 0),
    });

    try {
      const labelaryRes = await fetch(
        "http://api.labelary.com/v1/printers/8dpmm/labels/1.57x1.18/0/",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "image/png",
          },
          body: zpl,
        },
      );
      if (!labelaryRes.ok) {
        return res.status(502).send(`labelary: ${labelaryRes.status}`);
      }
      const buf = Buffer.from(await labelaryRes.arrayBuffer());
      previewCache.set(cacheKey, buf);
      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "public, max-age=86400");
      res.send(buf);
    } catch (err) {
      res.status(502).send(`preview failed: ${String(err)}`);
    }
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
