import { afterEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { reportDegraded } from "./degraded";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

/**
 * The point of this module is that a recovered failure still reaches a human.
 * These tests pin the two things that make that true: something is sent to
 * Sentry at all, and the grouping key is stable across occurrences.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(Sentry.captureMessage).mockClear();
});

describe("reportDegraded", () => {
  it("raises a warning-level Sentry event, not just a console line", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    reportDegraded("quote.square-calculate-failed", { lineCount: 3 });

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "degraded: quote.square-calculate-failed",
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("still logs, so the failure is greppable in the platform logs too", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    reportDegraded("quote.menu-unavailable", { lineCount: 1 });

    expect(logged).toHaveBeenCalledWith(
      "[degraded] quote.menu-unavailable",
      expect.stringContaining("lineCount"),
    );
  });

  it("groups two occurrences of one degradation under the same key", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    reportDegraded("quote.menu-unavailable", { lineCount: 1 });
    reportDegraded("quote.menu-unavailable", { lineCount: 9 });

    const [first, second] = vi.mocked(Sentry.captureMessage).mock.calls;
    // Same message and same tag: 200 occurrences must read as one problem, not
    // 200 problems. The varying part rides in `extra`, which does not group.
    expect(first[0]).toBe(second[0]);
    expect(first[1]).toMatchObject({
      tags: { degraded: "quote.menu-unavailable" },
    });
  });

  it("folds an Error cause down to its message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    reportDegraded("quote.menu-unavailable", {}, new Error("catalog timeout"));

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ extra: { cause: "catalog timeout" } }),
    );
  });

  it("omits the cause key entirely when there is no cause", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    reportDegraded("quote.menu-unavailable", { lineCount: 2 });

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ extra: { lineCount: 2 } }),
    );
  });
});
