import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callDeepSeek, DeepSeekError, CHAT_TOOLS } from "@/lib/chat/deepseek";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  process.env.DEEPSEEK_API_KEY = "test-key";
  delete process.env.DEEPSEEK_BASE_URL;
  delete process.env.DEEPSEEK_MODEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("CHAT_TOOLS", () => {
  it("exposes exactly the five tools the customer chat is allowed", () => {
    // check_my_order joined the list on 17 August. A customer who had already
    // ordered asked three times whether anyone had picked it up and was sent
    // to the phone three times, because nothing here could look.
    //
    // It reads the session rather than an argument, so it can only ever return
    // the order of the person being spoken to — which is why widening the list
    // by one is safe. Anything that took a customer id would not be.
    expect(CHAT_TOOLS.map((t) => t.function.name).sort()).toEqual([
      "check_my_order",
      "file_complaint",
      "go_checkout",
      "propose_drink",
      "show_promotion",
    ]);
  });

  it("lets check_my_order take no arguments at all", () => {
    // The whole safety property. An argument would be a way to name somebody
    // else's order, and the model would eventually be talked into filling it.
    const tool = CHAT_TOOLS.find((t) => t.function.name === "check_my_order");
    expect(tool?.function.parameters.properties).toEqual({});
    expect(tool?.function.parameters.additionalProperties).toBe(false);
  });
});

describe("callDeepSeek", () => {
  it("posts to the OpenAI-compatible completions path with the default model", async () => {
    fetchMock.mockResolvedValue(
      ok({ choices: [{ message: { content: "hi", tool_calls: [] } }] }),
    );
    await callDeepSeek([{ role: "user", content: "hi" }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("deepseek-v4-flash");
    // Counted from the list rather than written out, so adding a tool changes
    // it in the one place above that is meant to be argued about.
    expect(body.tools).toHaveLength(CHAT_TOOLS.length);
  });

  it("sends the API key as a bearer token", async () => {
    fetchMock.mockResolvedValue(ok({ choices: [{ message: { content: "" } }] }));
    await callDeepSeek([{ role: "user", content: "hi" }]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key",
    );
  });

  it("honours DEEPSEEK_BASE_URL and DEEPSEEK_MODEL overrides", async () => {
    process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com/beta";
    process.env.DEEPSEEK_MODEL = "deepseek-v4-flash";
    fetchMock.mockResolvedValue(ok({ choices: [{ message: { content: "" } }] }));
    await callDeepSeek([{ role: "user", content: "hi" }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/beta/chat/completions");
    expect(JSON.parse((init as RequestInit).body as string).model).toBe(
      "deepseek-v4-flash",
    );
  });

  it("normalizes tool calls into a flat shape", async () => {
    fetchMock.mockResolvedValue(
      ok({
        choices: [
          {
            message: {
              content: "推荐这杯",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "propose_drink", arguments: '{"itemId":"X"}' },
                },
              ],
            },
          },
        ],
      }),
    );
    const reply = await callDeepSeek([{ role: "user", content: "taro" }]);
    expect(reply.content).toBe("推荐这杯");
    expect(reply.toolCalls).toEqual([
      { id: "call_1", name: "propose_drink", argumentsJson: '{"itemId":"X"}' },
    ]);
  });

  it("returns empty content rather than null", async () => {
    fetchMock.mockResolvedValue(ok({ choices: [{ message: { content: null } }] }));
    expect((await callDeepSeek([{ role: "user", content: "x" }])).content).toBe("");
  });

  it("throws DeepSeekError on a non-2xx response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    } as Response);
    await expect(callDeepSeek([{ role: "user", content: "x" }])).rejects.toBeInstanceOf(
      DeepSeekError,
    );
  });

  // Finding 3: the base Error class leaves `.name` as "Error", so a
  // timeout, a rotated-key 401, and an empty-balance 402 were
  // indistinguishable in the route's log line. `.name` fixes the class
  // identity; `.status` (next test) fixes the case-specific detail without
  // ever having to log `.message`, which can embed the raw upstream body.
  it("sets its own name instead of the base Error class's \"Error\"", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    try {
      await callDeepSeek([{ role: "user", content: "x" }]);
      throw new Error("expected callDeepSeek to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DeepSeekError);
      expect((err as DeepSeekError).name).toBe("DeepSeekError");
    }
  });

  it("carries the upstream HTTP status on a non-2xx response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "invalid api key",
    } as Response);

    let caught: unknown;
    try {
      await callDeepSeek([{ role: "user", content: "x" }]);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DeepSeekError);
    expect((caught as DeepSeekError).status).toBe(401);
  });

  it("leaves status unset for a failure that never got an upstream response", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    let caught: unknown;
    try {
      await callDeepSeek([{ role: "user", content: "x" }]);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DeepSeekError);
    expect((caught as DeepSeekError).status).toBeUndefined();
  });

  it("throws DeepSeekError when the API key is missing", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await expect(callDeepSeek([{ role: "user", content: "x" }])).rejects.toBeInstanceOf(
      DeepSeekError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The timeout is implemented with AbortController. An aborted request must
  // be reported distinguishably from an ordinary network failure (e.g. DNS
  // failure, connection reset) so callers can tell "DeepSeek was too slow"
  // apart from "DeepSeek/network is broken" — and the abort timer must be
  // cleared on every path, or it leaks and can fire after the promise has
  // already settled.

  it("reports an aborted request distinguishably from a network failure", async () => {
    const abortError = new DOMException("This operation was aborted", "AbortError");
    fetchMock.mockRejectedValue(abortError);

    let caught: unknown;
    try {
      await callDeepSeek([{ role: "user", content: "x" }], { timeoutMs: 5 });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DeepSeekError);
    expect((caught as DeepSeekError).message).toMatch(/timed out/i);
  });

  it("reports a plain network failure without claiming it was a timeout", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    let caught: unknown;
    try {
      await callDeepSeek([{ role: "user", content: "x" }]);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DeepSeekError);
    expect((caught as DeepSeekError).message).not.toMatch(/timed out/i);
  });

  it("clears the abort timer after a successful response", async () => {
    const clearSpy = vi.spyOn(global, "clearTimeout");
    fetchMock.mockResolvedValue(ok({ choices: [{ message: { content: "hi" } }] }));

    await callDeepSeek([{ role: "user", content: "x" }]);

    expect(clearSpy).toHaveBeenCalled();
  });

  it("clears the abort timer even when fetch rejects", async () => {
    const clearSpy = vi.spyOn(global, "clearTimeout");
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await expect(callDeepSeek([{ role: "user", content: "x" }])).rejects.toBeInstanceOf(
      DeepSeekError,
    );

    expect(clearSpy).toHaveBeenCalled();
  });

  it("clears the abort timer even when the response is a non-2xx", async () => {
    const clearSpy = vi.spyOn(global, "clearTimeout");
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    } as Response);

    await expect(callDeepSeek([{ role: "user", content: "x" }])).rejects.toBeInstanceOf(
      DeepSeekError,
    );

    expect(clearSpy).toHaveBeenCalled();
  });
});
