import { describe, it, expect } from "vitest";
import { guardComplaint } from "./complaint-guard";

describe("guardComplaint", () => {
  it("blocks the exact question that got misfiled as a complaint", () => {
    // 2026-08-12: a customer asked whether they could redeem their free
    // drink and Mandy apologised for the inconvenience, filed a complaint
    // and asked for their order number. Twice.
    for (const ask of [
      "我可以免费换了吗",
      "我可以免费换饮品了吗",
      "几颗星可以换免费的",
      "can I redeem my free drink yet?",
      "how many stars do I need?",
    ]) {
      const v = guardComplaint(ask);
      expect(v.allow, ask).toBe(false);
      if (!v.allow) expect(v.reason).toContain("show_promotion");
    }
  });

  it("lets a real complaint through", () => {
    for (const said of [
      "我的奶茶洒了",
      "少了一杯",
      "等了一个小时还没送到",
      "the drink was cold and tasted awful",
      "my order never arrived",
      "送错了饮品",
    ]) {
      expect(guardComplaint(said).allow, said).toBe(true);
    }
  });

  it("blocks a filing when nothing at all was described", () => {
    const v = guardComplaint("你好");
    expect(v.allow).toBe(false);
    if (!v.allow) expect(v.reason).toContain("Ask what went wrong");
  });

  it("allows a complaint described earlier in the conversation", () => {
    // The guard sees every customer turn, because someone can describe the
    // problem first and then answer a follow-up with just an order number.
    const conversation = ["我的珍珠奶茶洒了一半", "A103"].join("\n");
    expect(guardComplaint(conversation).allow).toBe(true);
  });

  it("treats a promo question that ALSO reports a problem as a complaint", () => {
    // "我有优惠券但是饮品是坏的" — the grievance wins.
    expect(guardComplaint("我有优惠券，但是饮品是坏的").allow).toBe(true);
  });
});
