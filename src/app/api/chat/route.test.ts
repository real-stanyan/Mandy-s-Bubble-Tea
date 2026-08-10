import { describe, it, expect, vi, beforeEach } from "vitest";
import { fixtureMenu } from "@/lib/chat/__fixtures__/menu";

// catalog.ts imports @/lib/square as a value at module scope, which throws
// without SQUARE_ACCESS_TOKEN (deliberately absent from .env.test). The
// route imports getMenu from @/lib/catalog as a value, so this stub has to
// be in place before that import resolves, same as menu-digest.test.ts.
vi.mock("@/lib/square", () => ({
  squareClient: { catalog: { list: vi.fn() } },
  SQUARE_LOCATION_ID: "test_location",
}));

const callDeepSeek = vi.fn();
const checkChatRateLimit = vi.fn();
// A vi.fn (not a plain arrow function) so the hashIp-throws test below can
// override its behavior per-test without touching the other cases.
const hashIp = vi.fn((ip: string) => `h:${ip}`);

vi.mock("@/lib/catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/catalog")>()),
  getMenu: async () => fixtureMenu(),
}));
vi.mock("@/lib/chat/deepseek", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/deepseek")>()),
  callDeepSeek,
}));
vi.mock("@/lib/chat/rate-limit", () => ({
  checkChatRateLimit,
  hashIp,
  CHAT_HOURLY_LIMIT: 30,
}));

const { POST } = await import("@/app/api/chat/route");

function req(body: unknown) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5" },
    body: JSON.stringify(body),
  });
}

const askTaro = { messages: [{ role: "user", content: "taro milk tea, half sugar" }] };

function proposeCall(args: unknown) {
  return {
    content: "这杯怎么样",
    toolCalls: [
      { id: "c1", name: "propose_drink", argumentsJson: JSON.stringify(args) },
    ],
  };
}

const goodArgs = {
  itemId: "ITEM_TARO",
  variationId: "ITEM_TARO_REG",
  modifiers: [
    { modifierId: "MOD_SUGAR_50", count: 1 },
    { modifierId: "MOD_ICE_REG", count: 1 },
  ],
  quantity: 1,
  reason: "半糖芋头奶茶",
};

beforeEach(() => {
  callDeepSeek.mockReset();
  checkChatRateLimit.mockReset();
  checkChatRateLimit.mockResolvedValue({ allowed: true, remaining: 29 });
  hashIp.mockReset();
  hashIp.mockImplementation((ip: string) => `h:${ip}`);
});

describe("POST /api/chat", () => {
  it("returns a priced proposal on a valid tool call", async () => {
    callDeepSeek.mockResolvedValue(proposeCall(goodArgs));
    const res = await POST(req(askTaro));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.proposal.itemName).toBe("Taro Milk Tea");
    expect(body.proposal.unitPriceCents).toBe("750");
    expect(body.proposal.totalCents).toBe("750");
    expect(body.degraded).toBe(false);
    expect(callDeepSeek).toHaveBeenCalledTimes(1);
  });

  it("feeds validation errors back and accepts the retry", async () => {
    callDeepSeek
      .mockResolvedValueOnce(proposeCall({ ...goodArgs, itemId: "ITEM_NOPE" }))
      .mockResolvedValueOnce(proposeCall(goodArgs));

    const body = await (await POST(req(askTaro))).json();
    expect(callDeepSeek).toHaveBeenCalledTimes(2);
    expect(body.proposal.itemId).toBe("ITEM_TARO");

    // The retry must carry the errors, or it's just a reroll.
    const retryMessages = callDeepSeek.mock.calls[1][0];
    expect(JSON.stringify(retryMessages)).toContain("ITEM_NOPE");
  });

  it("degrades after two failed validations instead of a third call", async () => {
    callDeepSeek.mockResolvedValue(proposeCall({ ...goodArgs, itemId: "ITEM_NOPE" }));
    const body = await (await POST(req(askTaro))).json();

    expect(callDeepSeek).toHaveBeenCalledTimes(2);
    expect(body.proposal).toBeNull();
    expect(body.degraded).toBe(true);
  });

  it("degrades with keyword suggestions when DeepSeek throws", async () => {
    callDeepSeek.mockRejectedValue(new Error("timeout"));
    const res = await POST(req(askTaro));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.degraded).toBe(true);
    expect(body.suggestions[0].itemId).toBe("ITEM_TARO");
  });

  it("passes go_checkout through as an action", async () => {
    callDeepSeek.mockResolvedValue({
      content: "好的，带你去结账",
      toolCalls: [{ id: "c2", name: "go_checkout", argumentsJson: "{}" }],
    });
    const body = await (await POST(req({ messages: [{ role: "user", content: "结账" }] }))).json();
    expect(body.action).toBe("checkout");
    expect(body.proposal).toBeNull();
  });

  it("returns 429 when rate limited and never calls the model", async () => {
    checkChatRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    const res = await POST(req(askTaro));
    expect(res.status).toBe(429);
    expect(callDeepSeek).not.toHaveBeenCalled();
  });

  it("rejects an over-long message", async () => {
    const res = await POST(req({ messages: [{ role: "user", content: "x".repeat(501) }] }));
    expect(res.status).toBe(400);
    expect(callDeepSeek).not.toHaveBeenCalled();
  });

  it("rejects an over-long history", async () => {
    const messages = Array.from({ length: 21 }, () => ({ role: "user", content: "hi" }));
    const res = await POST(req({ messages }));
    expect(res.status).toBe(400);
  });

  it("rejects a malformed body", async () => {
    const res = await POST(req({ nope: true }));
    expect(res.status).toBe(400);
  });

  it("still returns 200 and calls the model when hashIp throws (missing salt)", async () => {
    // rate-limit.ts's real hashIp() throws when CHAT_RATE_LIMIT_SALT is
    // unset — deliberately, so the raw IP can never be silently unsalted.
    // That throw happens outside checkChatRateLimit's own try/catch, so the
    // route must catch it itself and fail open exactly like a dead
    // Supabase counter would, rather than 500ing on every chat request.
    hashIp.mockImplementationOnce(() => {
      throw new Error("CHAT_RATE_LIMIT_SALT is not set");
    });
    callDeepSeek.mockResolvedValue(proposeCall(goodArgs));

    const res = await POST(req(askTaro));
    expect(res.status).toBe(200);
    expect(callDeepSeek).toHaveBeenCalledTimes(1);
    // Fails open without a hash to check — the counter call itself is
    // skipped rather than invoked with a bogus value.
    expect(checkChatRateLimit).not.toHaveBeenCalled();
  });
});
