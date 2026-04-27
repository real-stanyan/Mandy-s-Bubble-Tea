import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Order } from "square";

vi.mock("../supabase-server", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("./render-tsp100", () => ({ renderCupLabelToBitmap: vi.fn(async () => Buffer.from([1, 2, 3])) }));

import { enqueueCupLabelJobs } from "./enqueue";
import { getSupabaseAdmin } from "../supabase-server";

beforeEach(() => vi.clearAllMocks());

describe("enqueueCupLabelJobs", () => {
  it("creates one row per cup, expanding line items by quantity", async () => {
    const inserted: any[] = [];
    const upload = vi.fn(async () => ({ data: { path: "x" }, error: null }));
    (getSupabaseAdmin as any).mockReturnValue({
      from: () => ({ upsert: (rows: any[]) => { inserted.push(...rows); return { error: null }; } }),
      storage: { from: () => ({ upload }) },
    });

    const order = {
      id: "ord-1",
      lineItems: [
        { uid: "line-a", quantity: "2", name: "Pearl Milk Tea", modifiers: [{ name: "Pearl" }] },
        { uid: "line-b", quantity: "1", name: "Mango", modifiers: [] },
      ],
    } as unknown as Order;

    await enqueueCupLabelJobs({ order, stickerNumber: "OL100" });

    expect(inserted.length).toBe(3); // 2 + 1
    expect(inserted[0].line_id).toBe("line-a");
    expect(inserted[0].cup_idx).toBe(0);
    expect(inserted[1].cup_idx).toBe(1);
    expect(inserted[2].line_id).toBe("line-b");
    expect(inserted[2].cup_idx).toBe(0);
    expect(inserted.every(r => r.doodle_source === "default")).toBe(true);
    expect(inserted.every(r => typeof r.doodle_pool_key === "string")).toBe(true);
  });

  it("makes no DB call when lineItems is empty", async () => {
    const insertFn = vi.fn();
    const upload = vi.fn(async () => ({ data: { path: "x" }, error: null }));
    (getSupabaseAdmin as any).mockReturnValue({
      from: () => ({ upsert: insertFn, insert: insertFn }),
      storage: { from: () => ({ upload }) },
    });

    await enqueueCupLabelJobs({
      order: { id: "ord-2", lineItems: [] } as unknown as Order,
      stickerNumber: "OL000",
    });
    expect(insertFn).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("skips lines with qty <= 0", async () => {
    const inserted: any[] = [];
    const upload = vi.fn(async () => ({ data: { path: "x" }, error: null }));
    (getSupabaseAdmin as any).mockReturnValue({
      from: () => ({
        upsert: (rows: any[]) => { inserted.push(...rows); return { error: null }; },
      }),
      storage: { from: () => ({ upload }) },
    });

    await enqueueCupLabelJobs({
      order: {
        id: "ord-3",
        lineItems: [
          { uid: "line-zero", quantity: "0", name: "Test", modifiers: [] },
          { uid: "line-bad",  quantity: "abc", name: "Test", modifiers: [] },
          { uid: "line-real", quantity: "1", name: "Test", modifiers: [] },
        ],
      } as unknown as Order,
      stickerNumber: "OL000",
    });
    expect(inserted.length).toBe(1);
    expect(inserted[0].line_id).toBe("line-real");
  });

  it("uses index fallback when uid and catalogObjectId are both missing", async () => {
    const inserted: any[] = [];
    const upload = vi.fn(async () => ({ data: { path: "x" }, error: null }));
    (getSupabaseAdmin as any).mockReturnValue({
      from: () => ({
        upsert: (rows: any[]) => { inserted.push(...rows); return { error: null }; },
      }),
      storage: { from: () => ({ upload }) },
    });

    await enqueueCupLabelJobs({
      order: {
        id: "ord-4",
        lineItems: [
          { quantity: "1", name: "A", modifiers: [] },
          { quantity: "1", name: "B", modifiers: [] },
        ],
      } as unknown as Order,
      stickerNumber: "OL000",
    });
    expect(inserted.map(r => r.line_id)).toEqual(["idx-0", "idx-1"]);
  });

  it("falls back to '—' when modifiers is undefined or empty", async () => {
    const inserted: any[] = [];
    const upload = vi.fn(async () => ({ data: { path: "x" }, error: null }));
    (getSupabaseAdmin as any).mockReturnValue({
      from: () => ({
        upsert: (rows: any[]) => { inserted.push(...rows); return { error: null }; },
      }),
      storage: { from: () => ({ upload }) },
    });

    await enqueueCupLabelJobs({
      order: {
        id: "ord-5",
        lineItems: [
          { uid: "a", quantity: "1", name: "X" },           // no modifiers field at all
          { uid: "b", quantity: "1", name: "Y", modifiers: [] },
        ],
      } as unknown as Order,
      stickerNumber: "OL000",
    });
    expect(inserted.every(r => r.modifiers_text === "—")).toBe(true);
  });
});
