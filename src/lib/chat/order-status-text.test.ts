import { describe, it, expect } from "vitest";
import { describeOrderStatus } from "./order-status-text";

// The sentence handed back to the model. Composed here rather than assembled
// from fields for the same reason the staff assistant composes its own: a
// model that can paraphrase a number will eventually invent one, and this one
// is about a customer's own order.

describe("what the customer is told about their order", () => {
  it("gives the ten minutes when the order is new", () => {
    // The conversation that caused this: somebody had ordered, asked whether
    // anyone had picked it up, and was told three times to ring the shop.
    const said = describeOrderStatus({
      known: true,
      reference: "DE837",
      placedMinutesAgo: 4,
      isDelivery: true,
      inProgress: true,
    });
    expect(said).toMatch(/4 minutes ago/);
    expect(said).toMatch(/10 minutes/);
    expect(said).toMatch(/normal wait/);
  });

  it("corrects the premise rather than answering it", () => {
    // "How long to find a driver" has no answer, because nobody is looking
    // for one. Saying "I can't see driver availability" leaves the customer
    // believing in a wait that does not exist.
    const said = describeOrderStatus({
      known: true,
      reference: "DE837",
      placedMinutesAgo: 4,
      isDelivery: true,
      inProgress: true,
    });
    expect(said).toMatch(/delivers it itself/);
    expect(said).toMatch(/no driver to be found/);
  });

  it("says plainly when it has been too long", () => {
    const said = describeOrderStatus({
      known: true,
      reference: "DE837",
      placedMinutesAgo: 35,
      isDelivery: true,
      inProgress: true,
    });
    expect(said).toMatch(/longer than the usual/);
    expect(said).toMatch(/ringing the shop/);
  });

  it("does not promise a driver for a pickup order", () => {
    const said = describeOrderStatus({
      known: true,
      reference: "OL846",
      placedMinutesAgo: 3,
      isDelivery: false,
      inProgress: true,
    });
    expect(said).toMatch(/waiting at the counter/);
    expect(said).not.toMatch(/driver/);
  });

  it("asks a signed-out customer to sign in rather than guessing", () => {
    const said = describeOrderStatus({ known: false, reason: "signed-out" });
    expect(said).toMatch(/not signed in/);
  });

  it("says nothing at all when it could not check", () => {
    // A lookup that failed must not read like an answer.
    expect(describeOrderStatus({ known: false, reason: "unavailable" })).toMatch(
      /could not check/,
    );
    expect(describeOrderStatus({ known: false, reason: "none" })).toMatch(
      /cannot see any recent order/,
    );
  });
});
