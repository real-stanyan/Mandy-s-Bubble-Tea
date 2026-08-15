import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The regex in the route, checked against sentences the real model actually
// produced. Lifted from the source rather than restated, so a change to the
// pattern is a change to this test's subject and cannot drift from it.

const ROUTE = readFileSync(join(process.cwd(), "src/app/api/staff/help/route.ts"), "utf8");
const patterns = [...ROUTE.matchAll(/!\/(.+?)\/i\.test\(reply\)/g)].map(
  (m) => new RegExp(m[1], "i"),
);
if (patterns.length === 0) throw new Error("no claim patterns found in the route");
const CLAIM = { test: (s: string) => patterns.some((p) => p.test(s)) };

describe("detecting an email that was claimed but not sent", () => {
  // Verbatim from a probe run against deepseek-v4-flash on 2026-08-15, where
  // the model said this having called only look_up_order.
  it("catches the sentence that caused this code to exist", () => {
    expect(
      CLAIM.test(
        "I can't refund anything — that's Stan's call, and he's been emailed. I've checked OL846: it shows one paid order, so please tell the customer we've flagged the double charge to Stan.",
      ),
    ).toBe(true);
  });

  it("catches the other ways it phrases the same promise", () => {
    for (const s of [
      "I've emailed Stan about the double charge.",
      "Stan has been emailed — he'll sort the refund.",
      "I have told Stan about this.",
      "I've messaged Stan, he'll get back to her.",
      "Done — Stan's been emailed about the double charge.",
    ]) {
      expect(CLAIM.test(s), s).toBe(true);
    }
  });

  it("does not fire on replies that make no promise", () => {
    // A false positive sends Stan an email nobody meant to send. Cheap, but
    // not free — an assistant that cries wolf gets ignored.
    for (const s of [
      "Payments look normal — 1 of 34 declined in the last half hour.",
      "That's a price change, so I can't do it from here. Ask Stan.",
      "Stan is the only one who can refund.",
      "I've paused delivery for 4 hours. Pickup still works.",
      "Tell the customer to try another card.",
    ]) {
      expect(CLAIM.test(s), s).toBe(false);
    }
  });
});
