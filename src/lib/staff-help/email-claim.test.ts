import { describe, it, expect } from "vitest";
import { claimsEmailSent } from "./email-claim";
import { OWNER_NAME } from "./policy";

// Sentences the real model actually produced, checked against the real
// function. The first version of this file scraped regex literals out of the
// route's source, which broke the moment the route built them a different way
// — and broke as an unrunnable suite rather than a failed assertion.

const claims = (s: string) => claimsEmailSent(s, OWNER_NAME);

describe("detecting an email that was claimed but not sent", () => {
  it("catches the sentence that caused this code to exist", () => {
    // Verbatim from a probe run on 2026-08-15, where the model said this
    // having called only look_up_order.
    expect(
      claims(
        "I can't refund anything — that's Rick's call, and he's been emailed. I've checked OL846: it shows one paid order, so please tell the customer we've flagged the double charge to Rick.",
      ),
    ).toBe(true);
  });

  it("catches the other ways it phrases the same promise", () => {
    for (const s of [
      "I've emailed Rick about the double charge.",
      "Rick has been emailed — he'll sort the refund.",
      "I have told Rick about this.",
      "I've messaged Rick, he'll get back to her.",
      "Done — Rick's been emailed about the double charge.",
    ]) {
      expect(claims(s), s).toBe(true);
    }
  });

  it("catches it in the present tense", () => {
    // Verbatim from the shop on 15 August, during a payments outage. The
    // receipt showed only the three checks it had run; the escalation tool was
    // never called, and the old pattern's \bemail\b could not match "emailing".
    expect(
      claims("I can't fix card payments, so I'm emailing Rick now."),
    ).toBe(true);
    expect(claims("I'll email Rick straight away.")).toBe(true);
    expect(claims("I will let Rick know.")).toBe(true);
  });

  it("catches it in Chinese, which is what the counter actually speaks", () => {
    // The detector was English-only for its whole life, so in the language
    // staff use it had never once fired. Also verbatim from the shop.
    for (const s of [
      "已经发紧急邮件给 Rick 了，他会安排。",
      "我马上发邮件给 Rick。",
      "这个我处理不了，已经通知 Rick 了。",
      "我帮你告诉 Rick，他会尽快回复。",
    ]) {
      expect(claims(s), s).toBe(true);
    }
  });

  it("does not fire when it is asking permission rather than reporting", () => {
    // Verbatim from production on 15 August: told the fridge report was a
    // test, it offered to send and asked for confirmation. Nobody reading this
    // believes an email has gone, so sending one is noise — and an assistant
    // that cries wolf gets ignored, which costs more than the email saves.
    expect(
      claims(
        "如果冰箱真的坏了，我马上发邮件给 Rick；如果只是测试，我就先不发，免得他收到假警报。",
      ),
    ).toBe(false);
    expect(claims("Do you want me to email Rick about it?")).toBe(false);
    expect(claims("Shall I email Rick?")).toBe(false);
    expect(claims("要不要我发邮件给 Rick？")).toBe(false);
  });

  it("still fires on an unconditional claim in the same reply", () => {
    // The suppression must not swallow the real thing when both appear.
    expect(
      claims("已经发邮件给 Rick 了。如果他没回，你再叫我一声。"),
    ).toBe(true);
  });

  it("does not fire on Chinese that promises nothing", () => {
    for (const s of [
      "刷卡看起来正常，过去 30 分钟 34 笔只有 1 笔失败。",
      "退款只有 Rick 能处理。",
      "外送已经暂停 4 小时了，自助取餐照常。",
    ]) {
      expect(claims(s), s).toBe(false);
    }
  });

  it("does not fire on replies that make no promise", () => {
    // A false positive sends an email nobody meant to send. Cheap, but not
    // free — an assistant that cries wolf gets ignored.
    for (const s of [
      "Payments look normal — 1 of 34 declined in the last half hour.",
      "That's a price change, so I can't do it from here. Ask Rick.",
      "Rick is the only one who can refund.",
      "I've paused delivery for 4 hours. Pickup still works.",
      "Tell the customer to try another card.",
    ]) {
      expect(claims(s), s).toBe(false);
    }
  });

  it("follows the owner's name rather than a name of its own", () => {
    // The bug this guards: the prompt was renamed Stan to Rick and the check
    // was not, so it matched nothing at all and never said so.
    expect(claimsEmailSent("I've emailed Mandy about it.", "Mandy")).toBe(true);
    expect(claimsEmailSent("I've emailed Mandy about it.", "Rick")).toBe(false);
  });

  it("does not pair a verb in one sentence with the name in the next", () => {
    expect(claims("I emailed the supplier. Rick is away today.")).toBe(false);
  });
});
