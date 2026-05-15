import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Order } from "square";
import { pickDefaultForCup } from "@/lib/doodle/pool";

const uploadMock = vi.fn();
const upsertMock = vi.fn();
const downloadMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    storage: {
      from: (b: string) => ({
        upload: uploadMock,
        download: (...a: unknown[]) => downloadMock(b, ...a),
      }),
    },
    from: () => ({ upsert: upsertMock }),
  })),
}));

vi.mock("./render-zebra-cup", () => ({
  renderCupLabel: vi.fn().mockResolvedValue({
    zpl: "^XA^XZ",
    previewPng: Buffer.from([0]),
  }),
}));

import { enqueueCupLabelJobs } from "./enqueue";
import { renderCupLabel } from "./render-zebra-cup";
import { getSupabaseAdmin } from "@/lib/supabase-server";

const buildOrder = () => ({
  id: "ORD1",
  lineItems: [
    {
      uid: "sq-line-1",
      catalogObjectId: "VAR1",
      name: "Pearl Milk Tea",
      quantity: "2",
      modifiers: [
        { catalogObjectId: "MOD_PEARL", name: "Pearl" },
        { catalogObjectId: "MOD_50S", name: "50% sugar" },
      ],
    },
  ],
});

beforeEach(() => {
  uploadMock.mockReset().mockResolvedValue({ error: null });
  upsertMock.mockReset().mockResolvedValue({ error: null });
  downloadMock.mockReset();
  (renderCupLabel as unknown as ReturnType<typeof vi.fn>).mockClear();
});

describe("enqueueCupLabelJobs (default path, regression)", () => {
  it("inserts default-source rows when no doodleIds passed", async () => {
    await enqueueCupLabelJobs({
      order: buildOrder() as never,
      stickerNumber: "OL001",
    });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [rows] = upsertMock.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(rows[0].doodle_source).toBe("default");
    expect(rows[0].doodle_paths).toBeNull();
    expect(rows[0].doodle_pool_key).toBeTruthy();
  });
});

describe("enqueueCupLabelJobs (user-doodle path)", () => {
  it("uses user paths for cups present in doodleIds, defaults for others", async () => {
    const userPaths = [{ d: "M0,0 L10,10", stroke: "#000", width: 3 }];
    downloadMock.mockResolvedValue({
      data: { text: async () => JSON.stringify({ paths: userPaths }) },
      error: null,
    });

    const clientLineId = `VAR1::MOD_50S,MOD_PEARL`;
    await enqueueCupLabelJobs({
      order: buildOrder() as never,
      stickerNumber: "OL002",
      doodleIds: { [`${clientLineId}:0`]: "doodle-uuid-1" },
      userId: "user-1",
    });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [rows] = upsertMock.mock.calls[0];
    expect(rows).toHaveLength(2);

    const cup0 = rows.find((r: { cup_idx: number }) => r.cup_idx === 0);
    expect(cup0.doodle_source).toBe("user");
    expect(cup0.doodle_pool_key).toBeNull();
    expect(cup0.doodle_paths).toEqual(userPaths);

    const cup1 = rows.find((r: { cup_idx: number }) => r.cup_idx === 1);
    expect(cup1.doodle_source).toBe("default");
  });

  it("falls back to default if download fails (does not break the order)", async () => {
    downloadMock.mockResolvedValue({ data: null, error: { message: "not found" } });
    const clientLineId = `VAR1::MOD_50S,MOD_PEARL`;
    await enqueueCupLabelJobs({
      order: buildOrder() as never,
      stickerNumber: "OL003",
      doodleIds: { [`${clientLineId}:0`]: "missing-uuid" },
      userId: "user-1",
    });
    const [rows] = upsertMock.mock.calls[0];
    const cup0 = rows.find((r: { cup_idx: number }) => r.cup_idx === 0);
    expect(cup0.doodle_source).toBe("default");
  });
});

describe("enqueueCupLabelJobs (Phase 1 regression)", () => {
  it("creates one row per cup, expanding line items by quantity", async () => {
    const inserted: any[] = [];
    const upload = vi.fn(async () => ({ data: { path: "x" }, error: null }));
    (getSupabaseAdmin as any).mockReturnValue({
      from: () => ({ upsert: (rows: any[]) => { inserted.push(...rows); return { error: null }; } }),
      storage: { from: () => ({ upload }) },
    });

    // Two distinct catalog items so they hash to different clientLineIds
    // and don't share the cross-line cupIdx group counter (which is used
    // to merge Square's quantity-split lineItems for the same cart line).
    const order = {
      id: "ord-1",
      lineItems: [
        { uid: "line-a", catalogObjectId: "VAR_PEARL_MT", quantity: "2", name: "Pearl Milk Tea", modifiers: [{ catalogObjectId: "MOD_PEARL", name: "Pearl" }] },
        { uid: "line-b", catalogObjectId: "VAR_MANGO", quantity: "1", name: "Mango", modifiers: [] },
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

  it("skips lines with qty <= 0 or NaN qty", async () => {
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
          { uid: "line-zero", quantity: "0",   name: "Test", modifiers: [] },
          { uid: "line-bad",  quantity: "abc",  name: "Test", modifiers: [] },
          { uid: "line-real", quantity: "1",    name: "Test", modifiers: [] },
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

  it("emits empty modifiers_text when modifiers is undefined or empty (matches Zebra zpl)", async () => {
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
          { uid: "a", quantity: "1", name: "X" },
          { uid: "b", quantity: "1", name: "Y", modifiers: [] },
        ],
      } as unknown as Order,
      stickerNumber: "OL000",
    });
    expect(inserted.every(r => r.modifiers_text === "")).toBe(true);
  });
});

// Fix #1 regression — seed mismatch
describe("enqueueCupLabelJobs (Fix #1: clientLineId seeds the default pool)", () => {
  it("doodle_pool_key matches pickDefaultForCup(clientLineId, cupIdx), NOT pickDefaultForCup(line.uid, cupIdx)", async () => {
    // Build an order where line.uid and clientLineId are guaranteed to diverge
    // so we can distinguish which seed was used.
    // line.uid = "uid-A", line.catalogObjectId = "VAR1", modifiers = [MOD_PEARL]
    // => clientLineId = "VAR1::MOD_PEARL", lineId = "uid-A"
    // Verified: pickDefaultForCup("VAR1::MOD_PEARL", 0).key === "cloud"
    //           pickDefaultForCup("uid-A",           0).key === "bunny"
    const expectedKey = pickDefaultForCup("VAR1::MOD_PEARL", 0).key;
    const wrongKey    = pickDefaultForCup("uid-A",           0).key;
    // Sanity: ensure the test actually distinguishes the two seeds
    expect(expectedKey).not.toBe(wrongKey);

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
        id: "ord-fix1",
        lineItems: [
          {
            uid: "uid-A",
            catalogObjectId: "VAR1",
            name: "Pearl Milk Tea",
            quantity: "1",
            modifiers: [{ catalogObjectId: "MOD_PEARL", name: "Pearl" }],
          },
        ],
      } as unknown as Order,
      stickerNumber: "OL-FIX1",
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0].doodle_pool_key).toBe(expectedKey);
    expect(inserted[0].doodle_pool_key).not.toBe(wrongKey);
  });
});

// Fix #2b regression — ignoreDuplicates flips based on doodle_source
describe("enqueueCupLabelJobs (Fix #2b: upsert ignoreDuplicates flips on user rows)", () => {
  it("uses ignoreDuplicates:true when all rows are default (webhook-style)", async () => {
    const upload = vi.fn(async () => ({ data: { path: "x" }, error: null }));
    (getSupabaseAdmin as any).mockReturnValue({
      from: () => ({ upsert: upsertMock }),
      storage: { from: () => ({ upload }) },
    });

    await enqueueCupLabelJobs({
      order: {
        id: "ord-fix2-default",
        lineItems: [
          { uid: "line-d1", quantity: "1", name: "Test", modifiers: [] },
        ],
      } as unknown as Order,
      stickerNumber: "OL-D1",
    });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [, opts] = upsertMock.mock.calls[0];
    expect(opts.ignoreDuplicates).toBe(true);
  });

  it("uses ignoreDuplicates:false when at least one row is user-sourced (payment-style)", async () => {
    // Provide a resolvable doodleId — downloadMock must return valid JSON paths
    const userPaths = [{ d: "M0,0 L5,5", stroke: "#111", width: 2 }];
    downloadMock.mockResolvedValue({
      data: { text: async () => JSON.stringify({ paths: userPaths }) },
      error: null,
    });

    const upload = vi.fn(async () => ({ data: { path: "x" }, error: null }));
    (getSupabaseAdmin as any).mockReturnValue({
      from: () => ({ upsert: upsertMock }),
      storage: { from: (b: string) => ({ upload, download: (...a: unknown[]) => downloadMock(b, ...a) }) },
    });

    const clientLineId = "VAR1::MOD_PEARL";
    await enqueueCupLabelJobs({
      order: {
        id: "ord-fix2-user",
        lineItems: [
          {
            uid: "uid-A",
            catalogObjectId: "VAR1",
            name: "Pearl Milk Tea",
            quantity: "1",
            modifiers: [{ catalogObjectId: "MOD_PEARL", name: "Pearl" }],
          },
        ],
      } as unknown as Order,
      stickerNumber: "OL-U1",
      doodleIds: { [`${clientLineId}:0`]: "doodle-fix2" },
      userId: "user-fix2",
    });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [, opts] = upsertMock.mock.calls[0];
    expect(opts.ignoreDuplicates).toBe(false);
  });
});
