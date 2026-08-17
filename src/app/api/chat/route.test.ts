import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
// complaint.ts pulls in supabase-server and the resend client at module
// scope, both of which want env this test file deliberately runs without.
const fileChatComplaint = vi.fn();
vi.mock("@/lib/chat/complaint", () => ({ fileChatComplaint }));
// store-status-server pulls in supabase-server at module scope.
const getDeliveryPause = vi.fn();
vi.mock("@/lib/store-status-server", () => ({ getDeliveryPause }));
// order-status.ts pulls in auth/square/driver-tokens at module scope; the
// route only ever needs the report string, so stub the whole lookup.
const lookupOrderStatusForChat = vi.fn();
vi.mock("@/lib/chat/order-status", () => ({ lookupOrderStatusForChat }));
// bulk-inquiry pulls in the resend client at module scope, same as complaint.
const sendBulkInquiry = vi.fn();
vi.mock("@/lib/chat/bulk-inquiry", () => ({ sendBulkInquiry }));
// customer-state reaches for supabase/loyalty at module scope; the real
// function returns null in this env anyway (no session on the request), so
// the mock's default matches production-for-a-stranger exactly.
const readCustomerPromoState = vi.fn();
vi.mock("@/lib/chat/customer-state", () => ({ readCustomerPromoState }));
// mystery-box pulls in supabase-server at module scope; the route only
// needs the code check here.
const isActiveMysteryCode = vi.fn();
const isMysteryBoxOpenAccess = vi.fn();
vi.mock("@/lib/mystery-box", () => ({
  isActiveMysteryCode,
  isMysteryBoxOpenAccess,
}));

const { POST, scrubPrices } = await import("@/app/api/chat/route");

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

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  getDeliveryPause.mockReset();
  getDeliveryPause.mockResolvedValue(null);
  fileChatComplaint.mockReset();
  fileChatComplaint.mockResolvedValue({ stored: true, emailed: true });
  callDeepSeek.mockReset();
  checkChatRateLimit.mockReset();
  checkChatRateLimit.mockResolvedValue({ allowed: true, remaining: 29 });
  hashIp.mockReset();
  hashIp.mockImplementation((ip: string) => `h:${ip}`);
  // Every degrade/failure path is expected to log now (Finding 3) — spy
  // rather than let it print, and silence it by default so passing tests
  // stay quiet; individual tests assert on calls where the log matters.
  sendBulkInquiry.mockReset();
  sendBulkInquiry.mockResolvedValue({ emailed: true });
  readCustomerPromoState.mockReset();
  readCustomerPromoState.mockResolvedValue(null);
  isActiveMysteryCode.mockReset();
  isActiveMysteryCode.mockResolvedValue(true);
  isMysteryBoxOpenAccess.mockReset();
  // Default to the code-gated round; the launch-round test opts in.
  isMysteryBoxOpenAccess.mockResolvedValue(false);
  lookupOrderStatusForChat.mockReset();
  lookupOrderStatusForChat.mockResolvedValue({
    signedOut: false,
    report:
      "Today's orders for this signed-in customer (1 total, newest first):\n- Order #A17 — 2x Taro Milk Tea — status: READY — waiting at the counter",
  });
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
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
    expect(callDeepSeek).toHaveBeenCalledTimes(1);
  });

  it("feeds validation errors back and accepts the retry", async () => {
    // `messages` is a single array the route mutates and reuses across
    // every callDeepSeek invocation in its retry loop, so
    // callDeepSeek.mock.calls[n][0] all alias the SAME object by the time
    // the test inspects it — reading that array after the fact would only
    // ever show its final state, not what it looked like at call N.
    // Snapshot a JSON copy the instant each call happens instead.
    const seenMessages: unknown[] = [];
    callDeepSeek.mockImplementation(async (messages: unknown) => {
      seenMessages.push(JSON.parse(JSON.stringify(messages)));
      return seenMessages.length === 1
        ? proposeCall({ ...goodArgs, itemId: "ITEM_NOPE" })
        : proposeCall(goodArgs);
    });

    const body = await (await POST(req(askTaro))).json();
    expect(callDeepSeek).toHaveBeenCalledTimes(2);
    expect(body.proposal.itemId).toBe("ITEM_TARO");

    const retryMessages = seenMessages[1] as { role: string }[];
    // Assert on the validator's own rejection text ("itemId ... is not on
    // the menu", from validate-proposal.ts), not on the rejected id alone.
    // The rejected tool call's raw arguments get echoed back as an
    // `assistant` message regardless of whether real error feedback is
    // sent, so an assertion that only looks for "ITEM_NOPE" would still
    // pass even if the `role: "tool"` error-feedback push were deleted
    // entirely and the retry were a bare reroll.
    expect(JSON.stringify(retryMessages)).toContain("is not on the menu");
    expect(retryMessages.some((m) => m.role === "tool")).toBe(true);
  });

  it("degrades after two failed validations instead of a third call", async () => {
    callDeepSeek.mockResolvedValue(proposeCall({ ...goodArgs, itemId: "ITEM_NOPE" }));
    const body = await (await POST(req(askTaro))).json();

    expect(callDeepSeek).toHaveBeenCalledTimes(2);
    expect(body.proposal).toBeNull();
    // "taro milk tea, half sugar" matches ITEM_TARO by keyword, so this is
    // the with-suggestions variant — ends in the colon that promises a
    // list (see Finding 1's no-suggestions tests below for the case where
    // it must NOT end this way).
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(body.reply).toMatch(/[:：]$/);
  });

  it("degrades with keyword suggestions when DeepSeek throws", async () => {
    callDeepSeek.mockRejectedValue(new Error("timeout"));
    const res = await POST(req(askTaro));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suggestions[0].itemId).toBe("ITEM_TARO");
    expect(body.reply).toMatch(/[:：]$/);
  });

  // Finding 1(a): fallbackMatch() can legitimately come back empty — most
  // reliably for a Chinese query, since the menu's item names are all
  // English and CJK-to-name matching essentially never hits (see Finding
  // 1(b)'s fallback-match.test.ts cases). Before this fix, both degrade
  // paths below used a message ending in "：", promising a list, and then
  // rendered nothing — indistinguishable from a crash. Now the
  // no-suggestions variant is used instead, which doesn't promise a list
  // and instead points at the menu.
  it("degrades to the no-suggestions message (not a broken promise of one) when DeepSeek throws on a query with no keyword match", async () => {
    callDeepSeek.mockRejectedValue(new Error("timeout"));
    const body = await (
      await POST(req({ messages: [{ role: "user", content: "拿铁咖啡" }] }))
    ).json();

    expect(body.suggestions).toEqual([]);
    expect(body.reply).not.toMatch(/：$/);
    expect(body.reply).toContain("菜单");
  });

  it("degrades to the no-suggestions message after two failed validations on a query with no keyword match", async () => {
    callDeepSeek.mockResolvedValue(proposeCall({ ...goodArgs, itemId: "ITEM_NOPE" }));
    const body = await (
      await POST(req({ messages: [{ role: "user", content: "拿铁咖啡" }] }))
    ).json();

    expect(body.proposal).toBeNull();
    expect(body.suggestions).toEqual([]);
    expect(body.reply).not.toMatch(/：$/);
    expect(body.reply).toContain("菜单");
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

  it("logs when the salt is missing, without leaking the salt or the raw IP", async () => {
    hashIp.mockImplementationOnce(() => {
      throw new Error("CHAT_RATE_LIMIT_SALT is not set");
    });
    callDeepSeek.mockResolvedValue(proposeCall(goodArgs));

    const res = await POST(req(askTaro));
    expect(res.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalled();

    const logged = consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(logged).toMatch(/salt/i);
    // The raw IP from the request's x-forwarded-for header must never
    // appear in a log line.
    expect(logged).not.toContain("203.0.113.5");
  });

  it("degrades instead of 500ing when propose_drink arguments are the literal null", async () => {
    // Valid JSON, but `JSON.parse("null") as DrinkProposal` is still
    // `null` — validateProposal() indexes straight into it
    // (`proposal.quantity`, `proposal.itemId`, ...) and throws a
    // TypeError. The model's tool call shape is steered by the customer's
    // own wording, so this is reachable, not hypothetical.
    callDeepSeek.mockResolvedValue({
      content: "这样如何",
      toolCalls: [{ id: "c3", name: "propose_drink", argumentsJson: "null" }],
    });

    const res = await POST(req(askTaro));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposal).toBeNull();
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(callDeepSeek).toHaveBeenCalledTimes(2);
  });

  it("degrades instead of 500ing when propose_drink arguments omit modifiers", async () => {
    // validateProposal() does `for (const ... of proposal.modifiers)` —
    // without a `modifiers` array that's a TypeError, not a validation
    // error, unless the route guards the call.
    const argsWithoutModifiers = {
      itemId: goodArgs.itemId,
      variationId: goodArgs.variationId,
      quantity: goodArgs.quantity,
      reason: goodArgs.reason,
    };
    callDeepSeek.mockResolvedValue(proposeCall(argsWithoutModifiers));

    const res = await POST(req(askTaro));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposal).toBeNull();
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(callDeepSeek).toHaveBeenCalledTimes(2);
  });

  it("does not show the failed attempt's own text on the degraded path", async () => {
    const modelText = "推荐芋头奶茶，只要$9.99哦";
    callDeepSeek.mockResolvedValue({
      content: modelText,
      toolCalls: [
        { id: "c1", name: "propose_drink", argumentsJson: JSON.stringify({ ...goodArgs, itemId: "ITEM_NOPE" }) },
      ],
    });

    const body = await (await POST(req(askTaro))).json();
    expect(body.proposal).toBeNull();
    expect(body.reply).not.toContain(modelText);
    expect(body.reply).not.toContain("$9.99");
  });

  it("scrubs an invented price out of a successful reply", async () => {
    callDeepSeek.mockResolvedValue({
      content: "这杯只要$9.99，超划算！",
      toolCalls: [{ id: "c1", name: "propose_drink", argumentsJson: JSON.stringify(goodArgs) }],
    });

    const body = await (await POST(req(askTaro))).json();
    expect(body.proposal).not.toBeNull();
    expect(body.reply).not.toContain("$9.99");
    // The real price still comes through on the card, untouched.
    expect(body.proposal.unitPriceCents).toBe("750");
  });

  // Finding 2: three sites build the customer-visible `reply`. Two applied
  // `||` BEFORE scrubPrices(), so a fallback could never fire once
  // scrubbing had already emptied the string; one had no fallback at all.
  // scrubPrices("$7.80") -> "" (see the scrubPrices tests below), and
  // deepseek.ts coerces a null model content to "" — so a model reply that
  // was nothing but a price used to reach the customer as a blank bubble
  // with no error, indistinguishable from a crash.
  describe("empty-after-scrub replies always fall back to non-empty text", () => {
    it("falls back on the go_checkout site", async () => {
      callDeepSeek.mockResolvedValue({
        content: "$9.99",
        toolCalls: [{ id: "c1", name: "go_checkout", argumentsJson: "{}" }],
      });
      const body = await (
        await POST(req({ messages: [{ role: "user", content: "结账" }] }))
      ).json();
      expect(body.reply.length).toBeGreaterThan(0);
      expect(body.reply).not.toContain("$");
    });

    it("falls back on the plain-conversational site (previously had no fallback at all)", async () => {
      callDeepSeek.mockResolvedValue({ content: "$9.99", toolCalls: [] });
      const body = await (await POST(req(askTaro))).json();
      expect(body.reply.length).toBeGreaterThan(0);
      expect(body.reply).not.toContain("$");
    });

    it("falls back to the proposal's own (scrubbed) reason when the model's reply is price-only", async () => {
      callDeepSeek.mockResolvedValue({
        content: "$9.99",
        toolCalls: [
          { id: "c1", name: "propose_drink", argumentsJson: JSON.stringify(goodArgs) },
        ],
      });
      const body = await (await POST(req(askTaro))).json();
      expect(body.reply.length).toBeGreaterThan(0);
      expect(body.reply).not.toContain("$");
      // goodArgs.reason ("半糖芋头奶茶") has no price in it, so it survives
      // scrubbing untouched and is exactly what should show up here.
      expect(body.reply).toBe(goodArgs.reason);
    });

    it("falls all the way through to the fixed fallback when both the reply and the reason are price-only", async () => {
      callDeepSeek.mockResolvedValue({
        content: "$9.99",
        toolCalls: [
          {
            id: "c1",
            name: "propose_drink",
            argumentsJson: JSON.stringify({ ...goodArgs, reason: "$5.00" }),
          },
        ],
      });
      const body = await (await POST(req(askTaro))).json();
      expect(body.reply.length).toBeGreaterThan(0);
      expect(body.reply).not.toContain("$");
    });
  });

  // Finding 4: the old price regex (`/\$\s?\d+(?:\.\d{1,2})?/g`) was
  // ASCII-only and mangled thousands separators. These pin the widened
  // coverage directly (scrubPrices is now exported from the route for
  // exactly this) rather than only indirectly through a POST round trip.
  describe("scrubPrices", () => {
    it("removes a plain ASCII dollar price (baseline, unchanged)", () => {
      expect(scrubPrices("only $7.80 today")).toBe("only today");
    });

    it("removes a price with a multi-space gap after the dollar sign", () => {
      expect(scrubPrices("only $  9.99 today")).toBe("only today");
    });

    it("removes a full-width dollar sign price", () => {
      expect(scrubPrices("只要＄9.99")).toBe("只要");
    });

    it("removes a thousands-separated price without leaving orphaned punctuation", () => {
      // The old regex matched only "$1" and left ",299" behind verbatim —
      // this is the exact corruption Finding 4 called out.
      expect(scrubPrices("It costs $1,299 today")).toBe("It costs today");
      expect(scrubPrices("$1,299")).not.toContain(",");
    });

    it("removes an AUD-prefixed price", () => {
      expect(scrubPrices("AUD 9.99 total")).toBe("total");
      expect(scrubPrices("AUD9.99 total")).toBe("total");
    });

    it("removes a trailing-元 price", () => {
      expect(scrubPrices("只要9.99元哦")).toBe("只要哦");
    });

    it("removes a trailing-块 price", () => {
      expect(scrubPrices("只要9.99块哦")).toBe("只要哦");
    });

    it("removes a trailing dollars-worded price", () => {
      expect(scrubPrices("just 9.99 dollars")).toBe("just");
    });

    it("removes the colloquial Chinese N块M pattern", () => {
      expect(scrubPrices("才7块5")).toBe("才");
    });

    it("leaves ordinary text with no price in it untouched", () => {
      expect(scrubPrices("半糖芋头奶茶")).toBe("半糖芋头奶茶");
    });
  });
});

describe("POST /api/chat — multi-drink orders", () => {
  it("returns one proposal per propose_drink call, all catalog-priced", async () => {
    callDeepSeek.mockResolvedValue({
      content: "两杯都来",
      toolCalls: [
        { id: "c1", name: "propose_drink", argumentsJson: JSON.stringify(goodArgs) },
        {
          id: "c2",
          name: "propose_drink",
          argumentsJson: JSON.stringify({
            ...goodArgs,
            itemId: "ITEM_BROWN",
            variationId: "ITEM_BROWN_REG",
            quantity: 2,
          }),
        },
      ],
    });

    const body = await (await POST(req(askTaro))).json();
    expect(body.proposals).toHaveLength(2);
    expect(body.proposals[0].itemName).toBe("Taro Milk Tea");
    expect(body.proposals[1].itemName).toBe("Brown Sugar Milk Tea");
    expect(body.proposals[1].totalCents).toBe("1500");
    // Back-compat mirror for clients rendered from the previous deploy.
    expect(body.proposal.itemName).toBe("Taro Milk Tea");
    expect(callDeepSeek).toHaveBeenCalledTimes(1);
  });

  it("rejects the turn when ANY drink fails validation, echoing every tool call", async () => {
    const seen: unknown[] = [];
    callDeepSeek.mockImplementation(async (messages: unknown) => {
      seen.push(JSON.parse(JSON.stringify(messages)));
      return seen.length === 1
        ? {
            content: "",
            toolCalls: [
              { id: "c1", name: "propose_drink", argumentsJson: JSON.stringify(goodArgs) },
              {
                id: "c2",
                name: "propose_drink",
                argumentsJson: JSON.stringify({ ...goodArgs, itemId: "ITEM_NOPE" }),
              },
            ],
          }
        : {
            content: "",
            toolCalls: [
              { id: "c3", name: "propose_drink", argumentsJson: JSON.stringify(goodArgs) },
            ],
          };
    });

    const body = await (await POST(req(askTaro))).json();
    expect(callDeepSeek).toHaveBeenCalledTimes(2);
    expect(body.proposals).toHaveLength(1);

    // The retry conversation must echo BOTH tool calls and answer each id —
    // a missing tool reply is a malformed OpenAI-protocol conversation.
    const retry = seen[1] as { role: string; tool_call_id?: string }[];
    const toolReplies = retry.filter((m) => m.role === "tool");
    expect(toolReplies.map((m) => m.tool_call_id)).toEqual(["c1", "c2"]);
  });
});

describe("POST /api/chat — complaints", () => {
  it("files the complaint and answers with the manager promise", async () => {
    callDeepSeek.mockResolvedValue({
      content: "非常抱歉！已经帮你记下来了，店长会在24小时内联系你。",
      toolCalls: [
        {
          id: "c1",
          name: "file_complaint",
          argumentsJson: JSON.stringify({ summary: "订单少了一杯", orderNumber: "A103" }),
        },
      ],
    });

    const body = await (
      await POST(req({ messages: [{ role: "user", content: "我的订单少了一杯" }] }))
    ).json();

    expect(fileChatComplaint).toHaveBeenCalledTimes(1);
    expect(fileChatComplaint.mock.calls[0][0]).toMatchObject({
      summary: "订单少了一杯",
      orderNumber: "A103",
    });
    expect(body.reply).toContain("24");
    expect(body.proposals).toEqual([]);
  });

  it("falls back to the raw customer message when the tool arguments are junk", async () => {
    callDeepSeek.mockResolvedValue({
      content: "",
      toolCalls: [{ id: "c1", name: "file_complaint", argumentsJson: "{not json" }],
    });

    const body = await (
      await POST(req({ messages: [{ role: "user", content: "my drink was wrong" }] }))
    ).json();

    expect(fileChatComplaint.mock.calls[0][0]).toMatchObject({
      summary: "my drink was wrong",
    });
    // Empty model text → fixed ack, in the customer's language (English here).
    expect(body.reply).toContain("24 hours");
  });

  it("withholds the promise when the complaint could be neither stored nor emailed", async () => {
    fileChatComplaint.mockResolvedValue({ stored: false, emailed: false });
    callDeepSeek.mockResolvedValue({
      content: "记下了！",
      toolCalls: [
        { id: "c1", name: "file_complaint", argumentsJson: JSON.stringify({ summary: "x" }) },
      ],
    });

    const body = await (
      await POST(req({ messages: [{ role: "user", content: "投诉" }] }))
    ).json();

    expect(body.reply).not.toContain("24");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe("POST /api/chat — impossible customer requests", () => {
  const fixedSweetArgs = {
    itemId: "ITEM_FIXED_SWEET",
    variationId: "ITEM_FIXED_SWEET_REG",
    modifiers: [
      { modifierId: "MOD_SUGAR_STD", count: 1 },
      { modifierId: "MOD_ICE_REG", count: 1 },
    ],
    quantity: 1,
    reason: "不加糖的奶茶",
  };

  it("rejects a proposal that ignores an impossible request, and says why", async () => {
    // The production regression (2026-08-11): the customer asked for a
    // drink with no sugar, that drink's SUGAR LEVEL is Standard/Extra
    // only, and the model answered "sure, no sugar" while proposing it
    // with the default. The card then contradicted the promise.
    const seen: unknown[] = [];
    callDeepSeek.mockImplementation(async (messages: unknown) => {
      seen.push(JSON.parse(JSON.stringify(messages)));
      return seen.length === 1
        ? proposeCall(fixedSweetArgs)
        : { content: "这款只有标准糖和多糖，做不了不加糖，要不要换一款？", toolCalls: [] };
    });

    const body = await (
      await POST(req({ messages: [{ role: "user", content: "Fixed Sweet Milk Tea 不要糖" }] }))
    ).json();

    expect(callDeepSeek).toHaveBeenCalledTimes(2);
    // Second turn is a plain explanation — no card promising the impossible.
    expect(body.proposals).toEqual([]);
    expect(body.reply).toContain("做不了");

    // The rejection must name the impossibility AND the real options, or
    // the retry is a reroll instead of a correction.
    const retry = JSON.stringify(seen[1]);
    expect(retry).toContain("no sugar-free option");
    expect(retry).toContain("Standard Sugar, Extra Sugar");
  });

  it("leaves a request the catalog CAN honour alone", async () => {
    // Same drink, same shape — but "去冰" is on its ICE list, so the
    // proposal must sail straight through on the first attempt.
    callDeepSeek.mockResolvedValue(
      proposeCall({
        ...fixedSweetArgs,
        modifiers: [
          { modifierId: "MOD_SUGAR_STD", count: 1 },
          { modifierId: "MOD_ICE_NONE", count: 1 },
        ],
      }),
    );
    const body = await (
      await POST(req({ messages: [{ role: "user", content: "Fixed Sweet Milk Tea 去冰" }] }))
    ).json();

    expect(callDeepSeek).toHaveBeenCalledTimes(1);
    expect(body.proposals).toHaveLength(1);
  });
});

describe("POST /api/chat — delivery pause reaches the model", () => {
  it("puts the live pause in the system prompt and drops the delivery facts", async () => {
    // The bug this pins (2026-08-11): the route fetched the pause and then
    // called buildSystemPrompt(menu) without it. The digest was correct,
    // the wiring was not, and production Mandy kept telling customers
    // "4217 is in our delivery area" while the shop was paused. Unit tests
    // on the digest could not see it — only the prompt actually sent can.
    getDeliveryPause.mockResolvedValue({
      until: "2026-08-11T07:00:00.000Z",
      reason: "maintenance",
    });
    callDeepSeek.mockResolvedValue({ content: "好的", toolCalls: [] });

    await POST(req({ messages: [{ role: "user", content: "可以送到4217吗" }] }));

    const messages = callDeepSeek.mock.calls[0][0] as { role: string; content: string }[];
    const systemPrompt = messages.find((m) => m.role === "system")!.content;
    expect(systemPrompt).toContain("DELIVERY IS PAUSED RIGHT NOW");
    expect(systemPrompt).not.toContain("4217");
  });

  it("keeps the delivery facts when nothing is paused", async () => {
    callDeepSeek.mockResolvedValue({ content: "好的", toolCalls: [] });
    await POST(req({ messages: [{ role: "user", content: "可以送到4217吗" }] }));

    const messages = callDeepSeek.mock.calls[0][0] as { role: string; content: string }[];
    const systemPrompt = messages.find((m) => m.role === "system")!.content;
    expect(systemPrompt).not.toContain("PAUSED");
    expect(systemPrompt).toContain("4217");
  });
});

describe("POST /api/chat — promotions, not complaints", () => {
  it("refuses to file a complaint about a free-drink question, and answers it", async () => {
    // The production regression (2026-08-12): "我可以免费换了吗" produced an
    // apology, a filed complaint and a request for the order number. The
    // customer was asking about their loyalty reward.
    const seen: unknown[] = [];
    callDeepSeek.mockImplementation(async (messages: unknown) => {
      seen.push(JSON.parse(JSON.stringify(messages)));
      return seen.length === 1
        ? {
            content: "不好意思给您带来不便了。",
            toolCalls: [
              {
                id: "c1",
                name: "file_complaint",
                argumentsJson: JSON.stringify({ summary: "想免费换" }),
              },
            ],
          }
        : {
            content: "你现在的星星还差一点，再买一杯就能换啦～",
            toolCalls: [
              { id: "c2", name: "show_promotion", argumentsJson: JSON.stringify({ key: "loyalty" }) },
            ],
          };
    });

    const body = await (
      await POST(req({ messages: [{ role: "user", content: "我可以免费换了吗" }] }))
    ).json();

    // No complaint was filed…
    expect(fileChatComplaint).not.toHaveBeenCalled();
    // …the model was told why, in terms it can act on…
    expect(JSON.stringify(seen[1])).toContain("show_promotion");
    // …and the customer got the loyalty card instead of an apology.
    expect(body.promotions).toHaveLength(1);
    expect(body.promotions[0].key).toBe("loyalty");
  });

  it("still files a real complaint", async () => {
    callDeepSeek.mockResolvedValue({
      content: "非常抱歉！",
      toolCalls: [
        {
          id: "c1",
          name: "file_complaint",
          argumentsJson: JSON.stringify({ summary: "饮品洒了" }),
        },
      ],
    });

    const body = await (
      await POST(req({ messages: [{ role: "user", content: "我的奶茶洒了一半" }] }))
    ).json();

    expect(fileChatComplaint).toHaveBeenCalledTimes(1);
    expect(body.reply).toContain("抱歉");
  });

  it("never emits a promotion the server didn't author", async () => {
    // The model picks a key; if it invents one there is no card, because a
    // model-authored discount is a promise checkout will not keep.
    callDeepSeek.mockResolvedValue({
      content: "给你个五折券！",
      toolCalls: [
        { id: "c1", name: "show_promotion", argumentsJson: JSON.stringify({ key: "half-price-everything" }) },
      ],
    });

    const body = await (
      await POST(req({ messages: [{ role: "user", content: "有什么活动" }] }))
    ).json();

    expect(body.promotions ?? []).toEqual([]);
  });
});

describe("POST /api/chat — offer_mystery_box", () => {
  const askSurprise = { messages: [{ role: "user", content: "暗号：芋头星人" }] };
  const boxCall = () => ({
    content: "接头成功！给你变一个盲盒！",
    toolCalls: [
      {
        id: "mb1",
        name: "offer_mystery_box",
        argumentsJson: JSON.stringify({ code: "芋头星人" }),
      },
    ],
  });

  it("hands an invalid code back to the model instead of rendering a box", async () => {
    readCustomerPromoState.mockResolvedValue({
      starBalance: 3,
      starsPerReward: 9,
      lifetimePoints: 3,
      mysteryCouponLabels: [],
      welcomeAvailable: false,
      igFollowAvailable: false,
      igFollowPercentage: 0,
      flashAvailable: false,
      flashPercentage: 0,
      appDownloadAvailable: false,
      appDownloadPercentage: 0,
    });
    isActiveMysteryCode.mockResolvedValue(false);
    const seen: unknown[] = [];
    callDeepSeek.mockImplementation(async (messages: unknown) => {
      seen.push(JSON.parse(JSON.stringify(messages)));
      return seen.length === 1
        ? boxCall()
        : { content: "这个暗号不对哦——去我们 Instagram 最新帖子找找！", toolCalls: [] };
    });
    const body = await (await POST(req(askSurprise))).json();
    expect(body.mysteryBox).toBeUndefined();
    expect(body.reply).toContain("Instagram");
    // The verdict reached the model as a tool message.
    const retry = seen[1] as { role: string; content: string | null }[];
    expect(retry.some((m) => m.role === "tool")).toBe(true);
  });

  it("launch round: renders a box with no code at all", async () => {
    readCustomerPromoState.mockResolvedValue({
      starBalance: 0,
      starsPerReward: 9,
      lifetimePoints: 0,
      mysteryCouponLabels: [],
      welcomeAvailable: false,
      igFollowAvailable: false,
      igFollowPercentage: 0,
      flashAvailable: false,
      flashPercentage: 0,
      appDownloadAvailable: false,
      appDownloadPercentage: 0,
    });
    isMysteryBoxOpenAccess.mockResolvedValue(true);
    isActiveMysteryCode.mockResolvedValue(false);
    callDeepSeek.mockResolvedValue({
      content: "给你变一个盲盒！",
      toolCalls: [{ id: "mb1", name: "offer_mystery_box", argumentsJson: "{}" }],
    });
    const body = await (
      await POST(req({ messages: [{ role: "user", content: "给我个惊喜" }] }))
    ).json();
    expect(body.mysteryBox).toBe(true);
    // No code to carry — the open endpoint resolves the launch round itself.
    expect(body.mysteryBoxCode).toBeUndefined();
  });

  it("renders the box for a signed-in customer", async () => {
    readCustomerPromoState.mockResolvedValue({
      starBalance: 3,
      starsPerReward: 9,
      lifetimePoints: 3,
      mysteryCouponLabels: [],
      welcomeAvailable: false,
      igFollowAvailable: false,
      igFollowPercentage: 0,
      flashAvailable: false,
      flashPercentage: 0,
      appDownloadAvailable: false,
      appDownloadPercentage: 0,
    });
    callDeepSeek.mockResolvedValue(boxCall());
    const body = await (await POST(req(askSurprise))).json();
    expect(body.mysteryBox).toBe(true);
    // The validated code rides along so the open call can carry it back.
    expect(body.mysteryBoxCode).toBe("芋头星人");
    expect(body.reply).toContain("盲盒");
  });

  it("swaps the box for a sign-in card when the asker is signed out — fixed copy, not the model's promise", async () => {
    callDeepSeek.mockResolvedValue(boxCall());
    const body = await (await POST(req(askSurprise))).json();
    expect(body.mysteryBox).toBeUndefined();
    expect(body.signIn).toBe(true);
    // The model's "给你变一个盲盒" must NOT survive — there is no box to tap.
    expect(body.reply).toContain("登录");
    expect(body.reply).not.toContain("变一个盲盒");
  });
});

describe("POST /api/chat — record_bulk_inquiry", () => {
  const askBulk = {
    messages: [{ role: "user", content: "我要订30杯，明天下午3点取，电话0400000123" }],
  };
  const goodArgsJson = JSON.stringify({
    cups: 30,
    when: "tomorrow 3pm",
    delivery: false,
    contact: "0400000123",
  });

  it("emails the inquiry and answers with the model's own acknowledgement", async () => {
    callDeepSeek.mockResolvedValue({
      content: "已经帮你把信息发给店里啦，他们会联系你确认细节。",
      toolCalls: [{ id: "b1", name: "record_bulk_inquiry", argumentsJson: goodArgsJson }],
    });
    const body = await (await POST(req(askBulk))).json();
    expect(sendBulkInquiry).toHaveBeenCalledWith(
      expect.objectContaining({ cups: 30, contact: "0400000123" }),
    );
    expect(body.reply).toContain("发给店里");
  });

  it("hands out the store phone when the email did NOT go — never a hollow callback promise", async () => {
    sendBulkInquiry.mockResolvedValue({ emailed: false });
    callDeepSeek.mockResolvedValue({
      content: "已经发给店里啦！",
      toolCalls: [{ id: "b1", name: "record_bulk_inquiry", argumentsJson: goodArgsJson }],
    });
    const body = await (await POST(req(askBulk))).json();
    // The model's optimistic sentence must be REPLACED by the honest copy.
    expect(body.reply).toContain("0404 978 238");
    expect(body.reply).not.toContain("发给店里啦");
  });

  it("treats malformed tool arguments as a failed send", async () => {
    callDeepSeek.mockResolvedValue({
      content: "好的！",
      toolCalls: [{ id: "b1", name: "record_bulk_inquiry", argumentsJson: "{not json" }],
    });
    const body = await (await POST(req(askBulk))).json();
    expect(sendBulkInquiry).not.toHaveBeenCalled();
    expect(body.reply).toContain("0404 978 238");
  });
});

describe("POST /api/chat — check_order_status", () => {
  const askReady = { messages: [{ role: "user", content: "It shows it's ready" }] };

  function statusCall() {
    return {
      content: "",
      toolCalls: [{ id: "os1", name: "check_order_status", argumentsJson: "{}" }],
    };
  }

  it("feeds the lookup report back and answers from the second round", async () => {
    const seen: unknown[] = [];
    callDeepSeek.mockImplementation(async (messages: unknown) => {
      seen.push(JSON.parse(JSON.stringify(messages)));
      return seen.length === 1
        ? statusCall()
        : { content: "Yes — order #A17 is ready at the counter!", toolCalls: [] };
    });

    const body = await (await POST(req(askReady))).json();

    expect(lookupOrderStatusForChat).toHaveBeenCalledTimes(1);
    expect(body.reply).toContain("#A17");
    // The second round must carry the report as a proper tool message —
    // that is the model's only window onto the counter.
    const retry = seen[1] as { role: string; content: string | null }[];
    const toolMsg = retry.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("READY — waiting at the counter");
  });

  it("looks up once even when the model repeats the call, then degrades honestly", async () => {
    callDeepSeek.mockResolvedValue(statusCall());
    const body = await (await POST(req(askReady))).json();

    // One Square lookup per request no matter how often the model loops.
    expect(lookupOrderStatusForChat).toHaveBeenCalledTimes(1);
    expect(body.proposal).toBeNull();
  });

  it("leaves the validation loop its retry after a status round", async () => {
    // A status turn costs a round-trip; the budget grows by one so a drink
    // proposed AFTER a status check still gets its correction cycle.
    let n = 0;
    callDeepSeek.mockImplementation(async () => {
      n += 1;
      if (n === 1) return statusCall();
      if (n === 2) return proposeCall({ ...goodArgs, itemId: "ITEM_NOPE" });
      return proposeCall(goodArgs);
    });

    const body = await (await POST(req(askTaro))).json();
    expect(callDeepSeek).toHaveBeenCalledTimes(3);
    expect(body.proposal.itemId).toBe("ITEM_TARO");
  });

  it("attaches the sign-in card when the lookup finds a signed-out asker", async () => {
    lookupOrderStatusForChat.mockResolvedValue({
      signedOut: true,
      report: "The customer is NOT signed in …",
    });
    let n = 0;
    callDeepSeek.mockImplementation(async () => {
      n += 1;
      return n === 1
        ? statusCall()
        : { content: "I can't see your order from here — sign in and I'll check.", toolCalls: [] };
    });

    const body = await (await POST(req(askReady))).json();
    expect(body.signIn).toBe(true);
    expect(body.reply).toContain("sign in");
  });

  it("sends no sign-in card for a signed-in asker", async () => {
    let n = 0;
    callDeepSeek.mockImplementation(async () => {
      n += 1;
      return n === 1
        ? statusCall()
        : { content: "Order #A17 is ready!", toolCalls: [] };
    });

    const body = await (await POST(req(askReady))).json();
    expect(body.signIn).toBeUndefined();
  });

  it("files the complaint first when both tools arrive in one turn", async () => {
    callDeepSeek.mockResolvedValue({
      content: "非常抱歉！",
      toolCalls: [
        {
          id: "c1",
          name: "file_complaint",
          argumentsJson: JSON.stringify({ summary: "饮品洒了" }),
        },
        { id: "os1", name: "check_order_status", argumentsJson: "{}" },
      ],
    });

    const body = await (
      await POST(req({ messages: [{ role: "user", content: "我的奶茶洒了一半" }] }))
    ).json();

    expect(fileChatComplaint).toHaveBeenCalledTimes(1);
    expect(lookupOrderStatusForChat).not.toHaveBeenCalled();
    expect(body.reply).toContain("抱歉");
  });
});
