import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock Sentry before importing the module under test.
const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (msg: string, opts?: unknown) => captureMessage(msg, opts),
}));

// reportClientError calls fetch(...) as fire-and-forget. Keep it inert.
const fetchMock = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal("fetch", fetchMock);

import { describeError, reportClientError } from "./client-error-report";

describe("reportClientError", () => {
  beforeEach(() => {
    captureMessage.mockClear();
    fetchMock.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("forwards to Sentry as a warning with structured tags/extra", () => {
    reportClientError({
      scope: "checkout",
      step: "payment",
      message: "Failed to fetch",
      meta: { payMethod: "apple-pay" },
    });

    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [msg, opts] = captureMessage.mock.calls[0];
    expect(msg).toBe("client-error: checkout/payment");
    expect(opts).toMatchObject({
      level: "warning",
      tags: { scope: "checkout", step: "payment" },
      extra: { payMethod: "apple-pay" },
    });
  });

  test("keeps logging to /api/client-log (back-compat)", () => {
    reportClientError({
      scope: "cart-drawer",
      step: "tokenize",
      message: "boom",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init).toMatchObject({
      method: "POST",
      keepalive: true,
    });
  });

  test("never throws even if Sentry throws", () => {
    captureMessage.mockImplementation(() => {
      throw new Error("sentry down");
    });

    expect(() =>
      reportClientError({ scope: "x", step: "y", message: "z" }),
    ).not.toThrow();
    // /api/client-log still attempted before the Sentry call returns/throws
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("describeError", () => {
  test("pulls message / name / squareErrors off an Error-like object", () => {
    const out = describeError(
      new (class FakeSquareError extends Error {
        errors = [{ code: "CARD_DECLINED", detail: "nope" }];
      })("card declined"),
    );
    expect(out.message).toBe("card declined");
    expect(out.name).toBe("Error"); // minified subclass name collapses to "Error"
    expect(out.squareErrors).toEqual([{ code: "CARD_DECLINED", detail: "nope" }]);
  });

  test("stringifies a non-object thrown value", () => {
    expect(describeError("network gone")).toEqual({ message: "network gone" });
  });
});
