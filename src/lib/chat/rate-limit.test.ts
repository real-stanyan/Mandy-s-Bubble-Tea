import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: () => ({ rpc }),
}));

const { checkChatRateLimit, hashIp, CHAT_HOURLY_LIMIT } = await import(
  "@/lib/chat/rate-limit"
);

beforeEach(() => {
  rpc.mockReset();
  process.env.CHAT_RATE_LIMIT_SALT = "test-salt";
});

describe("hashIp", () => {
  it("is deterministic", () => {
    expect(hashIp("203.0.113.5")).toBe(hashIp("203.0.113.5"));
  });

  it("separates different IPs", () => {
    expect(hashIp("203.0.113.5")).not.toBe(hashIp("203.0.113.6"));
  });

  it("does not leak the raw IP", () => {
    expect(hashIp("203.0.113.5")).not.toContain("203.0.113.5");
  });
});

describe("checkChatRateLimit", () => {
  it("allows a request below the limit", async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    const v = await checkChatRateLimit("abc");
    expect(v.allowed).toBe(true);
    expect(v.remaining).toBe(CHAT_HOURLY_LIMIT - 1);
  });

  it("blocks once the count passes the limit", async () => {
    rpc.mockResolvedValue({ data: CHAT_HOURLY_LIMIT + 1, error: null });
    const v = await checkChatRateLimit("abc");
    expect(v.allowed).toBe(false);
    expect(v.remaining).toBe(0);
  });

  it("allows exactly at the limit", async () => {
    rpc.mockResolvedValue({ data: CHAT_HOURLY_LIMIT, error: null });
    expect((await checkChatRateLimit("abc")).allowed).toBe(true);
  });

  it("fails open when Supabase errors", async () => {
    // A counter outage must not take the chatbox down with it. Losing a
    // limiter for a few minutes is cheaper than a dead feature.
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await checkChatRateLimit("abc")).allowed).toBe(true);
  });

  it("buckets by the hour", async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    await checkChatRateLimit("abc", new Date("2026-08-10T14:37:12.000Z"));
    expect(rpc).toHaveBeenCalledWith("bump_chat_rate_limit", {
      p_ip_hash: "abc",
      p_hour_bucket: "2026-08-10T14:00:00.000Z",
    });
  });
});
