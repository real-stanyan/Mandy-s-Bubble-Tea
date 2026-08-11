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
