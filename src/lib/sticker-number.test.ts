// src/lib/sticker-number.test.ts
import { describe, it, expect } from "vitest";
import { looksLikePhoneNumber, isUsableOrderTicketName } from "./sticker-number";

describe("looksLikePhoneNumber", () => {
  it("flags raw phone numbers Square POS may put in ticketName", () => {
    expect(looksLikePhoneNumber("+61451519606")).toBe(true); // the live incident
    expect(looksLikePhoneNumber("0451519606")).toBe(true); // local AU format
    expect(looksLikePhoneNumber("+61 451 519 606")).toBe(true); // spaced
    expect(looksLikePhoneNumber("0451-519-606")).toBe(true); // dashed
  });

  it("does NOT flag legitimate ticket / order numbers", () => {
    expect(looksLikePhoneNumber("8")).toBe(false); // POS register ticket
    expect(looksLikePhoneNumber("44")).toBe(false);
    expect(looksLikePhoneNumber("999")).toBe(false);
    expect(looksLikePhoneNumber("OL846")).toBe(false); // our web order number
    expect(looksLikePhoneNumber("TA47")).toBe(false); // our TA counter
    expect(looksLikePhoneNumber("")).toBe(false);
    expect(looksLikePhoneNumber("   ")).toBe(false);
  });
});

describe("isUsableOrderTicketName", () => {
  it("accepts real ticket / order numbers (carry a digit)", () => {
    expect(isUsableOrderTicketName("8")).toBe(true); // POS register ticket
    expect(isUsableOrderTicketName("44")).toBe(true);
    expect(isUsableOrderTicketName("OL846")).toBe(true); // our web order number
    expect(isUsableOrderTicketName("TA47")).toBe(true); // our TA counter
    expect(isUsableOrderTicketName(" 44 ")).toBe(true); // trimmed
  });

  it("rejects a customer NAME from an attached member (no digit)", () => {
    expect(isUsableOrderTicketName("Mao Sasaki")).toBe(false); // the live incident → must go to greeting
    expect(isUsableOrderTicketName("John")).toBe(false); // single-word name
    expect(isUsableOrderTicketName("Mary-Jane")).toBe(false);
  });

  it("rejects phone numbers (never print) and blanks", () => {
    expect(isUsableOrderTicketName("+61451519606")).toBe(false);
    expect(isUsableOrderTicketName("0451519606")).toBe(false);
    expect(isUsableOrderTicketName("")).toBe(false);
    expect(isUsableOrderTicketName("   ")).toBe(false);
  });
});
