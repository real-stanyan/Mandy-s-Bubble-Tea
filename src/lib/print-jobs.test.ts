import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Supabase admin client: the counter RPC + the print_jobs insert
// are the only DB touchpoints in enqueuePrintJob. We assert on the
// returned stickerNumber, which is what flows into the cup-label job.
const { rpcMock, insertMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  insertMock: vi.fn(),
}));

vi.mock("./supabase-server", () => ({
  getSupabaseAdmin: () => ({
    rpc: rpcMock,
    from: () => ({ insert: insertMock }),
  }),
}));

import type { Order } from "square";
import { enqueuePrintJob } from "./print-jobs";

function order(opts: {
  ticketName?: string;
  web?: boolean;
  metadataSource?: string;
}): Order {
  const metadataSource = opts.metadataSource ?? (opts.web ? "web" : undefined);
  return {
    id: "ORDER_TEST",
    state: "COMPLETED", // settles the gate without needing a tender
    ticketName: opts.ticketName,
    metadata: metadataSource ? { source: metadataSource } : undefined,
    source: { name: opts.web ? "Mandy's Bubble Tea Online Shop" : "Point of Sale" },
    lineItems: [{ uid: "l1", name: "Thai Milk Tea", quantity: "1", modifiers: [] }],
    totalMoney: { amount: 600n, currency: "AUD" },
  } as unknown as Order;
}

describe("enqueuePrintJob — sticker number guard (POS phone-ticketName incident)", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    insertMock.mockReset();
    rpcMock.mockResolvedValue({ data: 42, error: null }); // next_store_order_number
    insertMock.mockResolvedValue({ error: null });
  });

  it("falls back to the store counter when a POS ticketName is a phone number", async () => {
    // Square Register named the ticket after the attached member's phone.
    const res = await enqueuePrintJob({ order: order({ ticketName: "+61451519606" }) });
    expect(res).toMatchObject({ queued: true, stickerNumber: "42" });
    expect(rpcMock).toHaveBeenCalledWith("next_store_order_number");
    // The phone must never reach the printed sticker.
    expect((res as { stickerNumber: string }).stickerNumber).not.toContain("61451519606");
    // Plain number, not the old TA## format.
    expect((res as { stickerNumber: string }).stickerNumber).toMatch(/^\d+$/);
  });

  it("keeps a normal POS ticket number untouched", async () => {
    const res = await enqueuePrintJob({ order: order({ ticketName: "8" }) });
    expect(res).toMatchObject({ queued: true, stickerNumber: "8" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("falls back to the store counter when a POS ticketName is a customer name", async () => {
    // Square Register named the ticket after the attached member's NAME.
    // The name belongs in the "Hi, {name}" greeting, not the number slot.
    const res = await enqueuePrintJob({ order: order({ ticketName: "Mao Sasaki" }) });
    expect(res).toMatchObject({ queued: true, stickerNumber: "42" });
    expect(rpcMock).toHaveBeenCalledWith("next_store_order_number");
    expect((res as { stickerNumber: string }).stickerNumber).not.toContain("Sasaki");
    expect((res as { stickerNumber: string }).stickerNumber).toMatch(/^\d+$/);
  });

  it("falls back to the store counter when a POS order has no ticketName", async () => {
    const res = await enqueuePrintJob({ order: order({}) });
    expect(res).toMatchObject({ queued: true, stickerNumber: "42" });
  });

  it("keeps a web OL ticket number untouched", async () => {
    const res = await enqueuePrintJob({ order: order({ ticketName: "OL849", web: true }) });
    expect(res).toMatchObject({ queued: true, stickerNumber: "OL849" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

// #87: the column predates the app, so "not web" was written as "pos" — an
// app order was indistinguishable from a walk-in at the counter. That broke
// channel analysis, and left app orders out of the admin table's "线上"
// highlight, which keys off exactly this value.
describe("enqueuePrintJob — which channel the order came from", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    insertMock.mockReset();
    rpcMock.mockResolvedValue({ data: 42, error: null });
    insertMock.mockResolvedValue({ error: null });
  });

  const insertedSource = () =>
    (insertMock.mock.calls[0][0] as { source: string }).source;

  it("records an app order as app, not pos", async () => {
    await enqueuePrintJob({
      order: order({ ticketName: "OL850", metadataSource: "app" }),
    });
    expect(insertedSource()).toBe("app");
  });

  it("still records a web order as web", async () => {
    await enqueuePrintJob({ order: order({ ticketName: "OL849", web: true }) });
    expect(insertedSource()).toBe("web");
  });

  it("records an order with no metadata.source as pos", async () => {
    // Never went through our API — that's the in-store register.
    await enqueuePrintJob({ order: order({ ticketName: "8" }) });
    expect(insertedSource()).toBe("pos");
  });

  it("records an unrecognised metadata.source as pos rather than passing it through", async () => {
    // The column's CHECK only accepts the three known values; forwarding an
    // unknown one would fail the INSERT and silently drop the cup sticker.
    await enqueuePrintJob({
      order: order({ ticketName: "8", metadataSource: "kiosk" }),
    });
    expect(insertedSource()).toBe("pos");
  });
});
