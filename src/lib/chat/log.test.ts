import { describe, it, expect, vi, beforeEach } from "vitest";

const insert = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: () => ({ from: () => ({ insert }) }),
}));

const { recordChatTurns, normalizeConversationId, fallbackConversationId } =
  await import("./log");

describe("normalizeConversationId", () => {
  it("accepts ids shaped like the ones we mint", () => {
    expect(normalizeConversationId("a1b2-c3d4_e5")).toBe("a1b2-c3d4_e5");
    expect(normalizeConversationId("  trimmed  ")).toBe("trimmed");
  });

  it("rejects anything else — a stray id mixes strangers into one thread", () => {
    expect(normalizeConversationId("")).toBeNull();
    expect(normalizeConversationId(null)).toBeNull();
    expect(normalizeConversationId(42)).toBeNull();
    expect(normalizeConversationId("has spaces")).toBeNull();
    expect(normalizeConversationId("../../etc")).toBeNull();
    expect(normalizeConversationId("x".repeat(200))).toBeNull();
  });
});

describe("fallbackConversationId", () => {
  it("buckets a client without an id by hash and hour", () => {
    const at = new Date("2026-08-11T04:30:00.000Z");
    expect(fallbackConversationId("h:1.2.3.4", at)).toBe("anon-h:1.2.3.4-2026-08-11T04");
    // Same hour groups; the next hour starts a new thread.
    expect(fallbackConversationId("h:1.2.3.4", new Date("2026-08-11T04:59:00.000Z"))).toBe(
      fallbackConversationId("h:1.2.3.4", at),
    );
    expect(fallbackConversationId("h:1.2.3.4", new Date("2026-08-11T05:00:00.000Z"))).not.toBe(
      fallbackConversationId("h:1.2.3.4", at),
    );
  });
});

describe("recordChatTurns", () => {
  beforeEach(() => {
    insert.mockReset();
    insert.mockResolvedValue({ error: null });
  });

  it("maps turns onto the row shape", async () => {
    await recordChatTurns([
      {
        conversationId: "conv1",
        turnIndex: 0,
        role: "user",
        content: "来一杯芋头奶茶",
        surface: "web",
        ipHash: "h:x",
      },
      {
        conversationId: "conv1",
        turnIndex: 1,
        role: "assistant",
        content: "好的",
        surface: "web",
        ipHash: "h:x",
        proposalCount: 2,
        action: "checkout",
      },
    ]);
    const rows = insert.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      conversation_id: "conv1",
      turn_index: 1,
      role: "assistant",
      proposal_count: 2,
      action: "checkout",
    });
  });

  it("truncates rather than storing an unbounded blob", async () => {
    await recordChatTurns([
      {
        conversationId: "c",
        turnIndex: 0,
        role: "user",
        content: "x".repeat(5000),
        surface: null,
        ipHash: null,
      },
    ]);
    expect(insert.mock.calls[0][0][0].content.length).toBe(2000);
  });

  it("swallows a failing insert — logging must never break a chat", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    insert.mockResolvedValue({ error: { message: "relation does not exist" } });
    await expect(
      recordChatTurns([
        { conversationId: "c", turnIndex: 0, role: "user", content: "hi", surface: null, ipHash: null },
      ]),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does nothing at all for an empty batch", async () => {
    await recordChatTurns([]);
    expect(insert).not.toHaveBeenCalled();
  });
});
