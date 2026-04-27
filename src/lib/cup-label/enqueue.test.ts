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
      from: () => ({ insert: (rows: any[]) => { inserted.push(...rows); return { error: null }; } }),
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
});
