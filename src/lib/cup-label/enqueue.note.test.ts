// The customer note reaches the label renderer: from the line item's own
// note (web/app checkout, POS item note) or the legacy pickup-note shape.
import { describe, it, expect, vi, beforeEach } from "vitest";

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

type RenderArgs = { customerNote?: string | null; keepsake?: boolean; modifiersText: string };

const renderCalls = () =>
  (renderCupLabel as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([a]) => a as RenderArgs);

const order = (over: Record<string, unknown> = {}, lineNote?: string) => ({
  id: "ORD1",
  referenceId: "OL745",
  ticketName: "OL745",
  lineItems: [
    {
      uid: "sq-line-1",
      catalogObjectId: "VAR1",
      name: "Pearl Milk Tea",
      quantity: "2",
      modifiers: [{ catalogObjectId: "MOD_PEARL", name: "Pearl" }],
      ...(lineNote !== undefined ? { note: lineNote } : {}),
    },
  ],
  ...over,
});

beforeEach(() => {
  uploadMock.mockReset().mockResolvedValue({ error: null });
  upsertMock.mockReset().mockResolvedValue({ error: null });
  downloadMock.mockReset();
  (renderCupLabel as unknown as ReturnType<typeof vi.fn>).mockClear();
});

describe("enqueueCupLabelJobs — customer note", () => {
  it("passes the line item's note to every cup label of that line", async () => {
    await enqueueCupLabelJobs({ order: order({}, "  No ice   please ") as never, stickerNumber: "OL745" });
    const calls = renderCalls();
    expect(calls.length).toBe(2); // quantity 2, no keepsake
    for (const c of calls) expect(c.customerNote).toBe("No ice please");
  });

  it("falls back to the web checkout's pickup note ('<ticket> — <note>') for orders without line notes", async () => {
    await enqueueCupLabelJobs({
      order: order({
        fulfillments: [{ type: "PICKUP", pickupDetails: { note: "OL745 — extra pearls pls" } }],
      }) as never,
      stickerNumber: "OL745",
    });
    for (const c of renderCalls()) expect(c.customerNote).toBe("extra pearls pls");
  });

  it("sends null when neither the line nor the pickup note carries one", async () => {
    await enqueueCupLabelJobs({
      order: order({ fulfillments: [{ type: "PICKUP", pickupDetails: { note: "OL745" } }] }) as never,
      stickerNumber: "OL745",
    });
    for (const c of renderCalls()) expect(c.customerNote).toBeNull();
  });

  it("POS orders print a staff-typed item note the same way", async () => {
    await enqueueCupLabelJobs({
      order: order({}, "customer is allergic to peanuts") as never,
      stickerNumber: "47",
      mode: "pos",
    });
    for (const c of renderCalls()) expect(c.customerNote).toBe("customer is allergic to peanuts");
  });

  it("never mines a delivery fulfillment note (it carries the address and phone)", async () => {
    await enqueueCupLabelJobs({
      order: order({
        fulfillments: [
          { type: "PICKUP", pickupDetails: { note: "🚚 DELIVERY · 34 Davenport St · +61400000000 · ring the bell" } },
        ],
      }) as never,
      stickerNumber: "OL745",
    });
    for (const c of renderCalls()) expect(c.customerNote).toBeNull();
  });
});
