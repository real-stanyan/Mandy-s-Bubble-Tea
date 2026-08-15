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
