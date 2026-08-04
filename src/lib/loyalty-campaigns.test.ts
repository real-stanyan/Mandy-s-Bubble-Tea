import { describe, it, expect } from "vitest";
import { CAMPAIGNS, renderCopy } from "./loyalty-campaigns";

const STARS = 9;

describe("campaign audience predicates", () => {
  const redeem = CAMPAIGNS.redeem_ready;
  const near = CAMPAIGNS.near_threshold;

  it("redeem_ready matches only balances that cover a whole reward", () => {
    expect(redeem.match(8, STARS)).toBeNull();
    expect(redeem.match(9, STARS)).toBe(1);
    expect(redeem.match(17, STARS)).toBe(1);
    expect(redeem.match(18, STARS)).toBe(2);
  });

  it("near_threshold matches only 1-2 stars short", () => {
    expect(near.match(6, STARS)).toBeNull();
    expect(near.match(7, STARS)).toBe(2);
    expect(near.match(8, STARS)).toBe(1);
    expect(near.match(9, STARS)).toBeNull();
  });

  it("the two campaigns never target the same customer", () => {
    // They run independently and a customer in both would get two
    // contradictory notifications ("redeem your free drink" and "you're
    // 1 short") from a single balance.
    for (let balance = 0; balance <= 40; balance++) {
      const inBoth =
        redeem.match(balance, STARS) != null && near.match(balance, STARS) != null;
      expect(inBoth, `balance ${balance} matched both campaigns`).toBe(false);
    }
  });

  it("a negative balance (Square allows it after a refund) matches nothing", () => {
    expect(redeem.match(-3, STARS)).toBeNull();
    expect(near.match(-3, STARS)).toBeNull();
  });
});

describe("renderCopy", () => {
  const copy = {
    titleSingular: "one title",
    bodySingular: "one body",
    titlePlural: "{n} titles",
    bodyPlural: "you have {n} of them, {n} in total",
  };

  it("uses the singular copy for exactly 1", () => {
    expect(renderCopy(copy, 1)).toEqual({ title: "one title", body: "one body" });
  });

  it("substitutes every {n} in the plural copy", () => {
    expect(renderCopy(copy, 3)).toEqual({
      title: "3 titles",
      body: "you have 3 of them, 3 in total",
    });
  });

  it("leaves default copy free of stray placeholders in the singular form", () => {
    for (const c of Object.values(CAMPAIGNS)) {
      const rendered = renderCopy(c.defaultCopy, 1);
      expect(rendered.title).not.toContain("{n}");
      expect(rendered.body).not.toContain("{n}");
    }
  });
});
