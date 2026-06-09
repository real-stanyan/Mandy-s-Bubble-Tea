import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Order } from "square";

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
  it("inserts tarot-fallback rows when no doodleIds passed", async () => {
    await enqueueCupLabelJobs({
      order: buildOrder() as never,
      stickerNumber: "OL001",
    });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [rows] = upsertMock.mock.calls[0];
    expect(rows).toHaveLength(2);
    // No user choice → tarot card auto-fill. doodle_source = "preset_sticker",
    // doodle_pool_key = md5 hash of the chosen card.
    expect(rows[0].doodle_source).toBe("preset_sticker");
    expect(rows[0].doodle_paths).toBeNull();
    expect(rows[0].doodle_pool_key).toMatch(/^[a-f0-9]{32}$/);
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
    expect(cup1.doodle_source).toBe("preset_sticker");
  });

  it("falls back to tarot if download fails (does not break the order)", async () => {
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
    expect(cup0.doodle_source).toBe("preset_sticker");
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
    expect(inserted.every(r => r.doodle_source === "preset_sticker")).toBe(true);
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

// Tarot fallback contract: an order with no user choice produces rows
// with doodle_source="preset_sticker" and doodle_pool_key set to a
// 32-char md5 hash pointing at public/cup-label/tarot/<hash>/. The
// previous hash-based POOL.svg seeding (clientLineId-driven) was
// replaced when in-store + web-default both moved to the tarot deck.
describe("enqueueCupLabelJobs (tarot fallback for unchosen cups)", () => {
  it("emits doodle_source='preset_sticker' with an md5 hash for cups without a choice", async () => {
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
        id: "ord-tarot",
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
      stickerNumber: "OL-TAROT",
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0].doodle_source).toBe("preset_sticker");
    expect(inserted[0].doodle_pool_key).toMatch(/^[a-f0-9]{32}$/);
    expect(inserted[0].original_image_path).toMatch(
      /^cup-label\/tarot\/[a-f0-9]{32}\/binarized\.png$/,
    );
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

describe("enqueueCupLabelJobs (keepsake copies)", () => {
  const clientLineId = `VAR1::MOD_50S,MOD_PEARL`;
  const okDraw = () =>
    downloadMock.mockResolvedValue({
      data: {
        text: async () =>
          JSON.stringify({ paths: [{ d: "M0,0 L1,1", stroke: "#000", width: 3 }] }),
      },
      error: null,
    });

  it("emits one keepsake row (copy_idx 1) per customized cup, none for fallback cups", async () => {
    okDraw();
    await enqueueCupLabelJobs({
      order: buildOrder() as never, // qty 2: cup0 customized (drawn), cup1 fallback
      stickerNumber: "OL910",
      doodleIds: { [`${clientLineId}:0`]: "doodle-uuid-1" },
      userId: "user-1",
      includeKeepsakeCopies: true,
    });
    const [rows] = upsertMock.mock.calls[0];
    expect(rows).toHaveLength(3); // cup0 primary + cup0 keepsake + cup1 primary

    const keepsakes = rows.filter((r: { copy_idx: number }) => r.copy_idx === 1);
    expect(keepsakes).toHaveLength(1);
    expect(keepsakes[0].cup_idx).toBe(0);
    expect(keepsakes[0].doodle_source).toBe("user");
    expect(keepsakes[0].original_image_path).toBeNull();
    expect(keepsakes[0].ai_job_id).toBeNull();

    const keepsakeCalls = (
      renderCupLabel as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c) => c[0]?.keepsake === true);
    expect(keepsakeCalls).toHaveLength(1);
  });

  it("primary rows carry copy_idx 0", async () => {
    okDraw();
    await enqueueCupLabelJobs({
      order: buildOrder() as never,
      stickerNumber: "OL911",
      doodleIds: { [`${clientLineId}:0`]: "doodle-uuid-1" },
      userId: "user-1",
      includeKeepsakeCopies: true,
    });
    const [rows] = upsertMock.mock.calls[0];
    const primaries = rows.filter((r: { copy_idx: number }) => r.copy_idx === 0);
    expect(primaries).toHaveLength(2);
  });

  it("no keepsakes when flag is off (regression)", async () => {
    okDraw();
    await enqueueCupLabelJobs({
      order: buildOrder() as never,
      stickerNumber: "OL912",
      doodleIds: { [`${clientLineId}:0`]: "doodle-uuid-1" },
      userId: "user-1",
    });
    const [rows] = upsertMock.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(rows.every((r: { copy_idx: number }) => r.copy_idx === 0)).toBe(true);
  });

  it("no keepsakes for an all-fallback order even with flag on", async () => {
    await enqueueCupLabelJobs({
      order: buildOrder() as never,
      stickerNumber: "OL913",
      includeKeepsakeCopies: true,
    });
    const [rows] = upsertMock.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(rows.some((r: { copy_idx: number }) => r.copy_idx === 1)).toBe(false);
  });

  it("upsert onConflict includes copy_idx", async () => {
    okDraw();
    await enqueueCupLabelJobs({
      order: buildOrder() as never,
      stickerNumber: "OL914",
      doodleIds: { [`${clientLineId}:0`]: "doodle-uuid-1" },
      userId: "user-1",
      includeKeepsakeCopies: true,
    });
    expect(upsertMock.mock.calls[0][1].onConflict).toBe(
      "square_order_id,line_id,cup_idx,copy_idx",
    );
  });
});
