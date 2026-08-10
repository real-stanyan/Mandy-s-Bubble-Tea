import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: () => ({ rpc }),
}));

const { checkChatRateLimit, hashIp, CHAT_HOURLY_LIMIT } = await import(
  "@/lib/chat/rate-limit"
);

// Both fail-open branches (RPC error, RPC throw) now log — see Finding 3.
// Spy and silence by default so the passing-case tests below stay quiet;
// the dedicated "logs" tests assert on calls where the log matters.
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  rpc.mockReset();
  process.env.CHAT_RATE_LIMIT_SALT = "test-salt";
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
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

  it("throws when the salt is unset", () => {
    delete process.env.CHAT_RATE_LIMIT_SALT;
    expect(() => hashIp("203.0.113.5")).toThrow(/CHAT_RATE_LIMIT_SALT/);
  });

  it("throws when the salt is an empty string", () => {
    process.env.CHAT_RATE_LIMIT_SALT = "";
    expect(() => hashIp("203.0.113.5")).toThrow(/CHAT_RATE_LIMIT_SALT/);
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

  it("fails open on an error even with a numeric data payload", async () => {
    // data:null alone would already satisfy `typeof data !== "number"`, so
    // this pins down that the `error` branch is actually checked, not just
    // the data type: an implementation that ignored `error` would compute
    // this as "999 > CHAT_HOURLY_LIMIT" and wrongly block instead of
    // failing open.
    rpc.mockResolvedValue({ data: 999, error: { message: "boom" } });
    const v = await checkChatRateLimit("abc");
    expect(v.allowed).toBe(true);
    expect(v.remaining).toBe(CHAT_HOURLY_LIMIT);
  });

  it("fails open when the RPC call rejects outright", async () => {
    // Covers the try/catch path (e.g. network failure before Supabase ever
    // returns a { data, error } pair), distinct from a resolved error.
    rpc.mockRejectedValue(new Error("network"));
    const v = await checkChatRateLimit("abc");
    expect(v.allowed).toBe(true);
    expect(v.remaining).toBe(CHAT_HOURLY_LIMIT);
  });

  // Finding 3: both fail-open branches used to return silently. If the RPC
  // breaks, the log line is the only way anyone finds out the rate limiter
  // is gone before the DeepSeek bill does.
  it("logs what degraded when failing open on a Supabase RPC error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    await checkChatRateLimit("abc");

    expect(consoleErrorSpy).toHaveBeenCalled();
    const logged = consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(logged).toMatch(/rate limit/i);
    // The error's own message is fine to log; the raw Supabase error
    // object itself (which could carry connection details) must not be.
    expect(logged).toContain("connection refused");
  });

  it("logs what degraded when the RPC call throws outright", async () => {
    rpc.mockRejectedValue(new Error("network unreachable"));
    await checkChatRateLimit("abc");

    expect(consoleErrorSpy).toHaveBeenCalled();
    const logged = consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(logged).toMatch(/rate limit/i);
    expect(logged).toContain("network unreachable");
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
