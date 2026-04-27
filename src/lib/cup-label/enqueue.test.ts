import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadMock = vi.fn();
const upsertMock = vi.fn();
const downloadMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: (b: string) => ({
        upload: uploadMock,
        download: (...a: unknown[]) => downloadMock(b, ...a),
      }),
    },
    from: () => ({ upsert: upsertMock }),
  }),
}));

vi.mock("./render-tsp100", () => ({
  renderCupLabelToBitmap: vi.fn().mockResolvedValue(Buffer.from([0])),
}));

import { enqueueCupLabelJobs } from "./enqueue";
import { renderCupLabelToBitmap } from "./render-tsp100";

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
  (renderCupLabelToBitmap as unknown as ReturnType<typeof vi.fn>).mockClear();
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
