import { describe, it, expect } from "vitest";
import {
  buildComplaintEmail,
  resolveReplyTo,
  type ComplaintMailInput,
} from "./complaint-mail";

const baseInput: ComplaintMailInput = {
  orderId: "abc123",
  pickupNumber: "OL816",
  customerName: "Stan Yan",
  customerPhone: "+61412345678",
  customerEmail: "stan@example.com",
  description: "Pearls were hard and the milk tea tasted off.",
  placedAt: "2026-04-26T00:34:00Z",
  closedAt: "2026-04-26T01:02:00Z",
  totalsLine: "Subtotal $14.70 · PH 10% $1.47 · Platform 0.5% $0.07 · Card 1.9% $0.27 · Total $16.51",
  itemLines: [
    "Brown Sugar Milk Tea (Large, 50% sugar, Less ice, Pearl ×2)  $7.20",
    "Lychee Slushy (Regular, 100% sugar, Cheese Cream)            $7.50",
  ],
  attachments: [
    { filename: "photo-1.jpg", contentBase64: "AAAA" },
    { filename: "photo-2.jpg", contentBase64: "BBBB" },
  ],
};

describe("resolveReplyTo", () => {
  it("returns the email when it's a real address", () => {
    expect(resolveReplyTo("stan@example.com")).toBe("stan@example.com");
  });

  it("returns null for the supabase placeholder pattern", () => {
    expect(resolveReplyTo("12345@phone.supabase.local")).toBeNull();
  });

  it("returns null for the deleted marker", () => {
    expect(resolveReplyTo("uuid-here@deleted.invalid")).toBeNull();
  });

  it("returns null for null / empty", () => {
    expect(resolveReplyTo(null)).toBeNull();
    expect(resolveReplyTo("")).toBeNull();
  });
});

describe("buildComplaintEmail", () => {
  it("subject contains pickup number + customer name", () => {
    const m = buildComplaintEmail(baseInput);
    expect(m.subject).toContain("OL816");
    expect(m.subject).toContain("Stan Yan");
  });

  it("plaintext body contains all line items + totals + description", () => {
    const m = buildComplaintEmail(baseInput);
    expect(m.text).toContain("Brown Sugar Milk Tea");
    expect(m.text).toContain("Lychee Slushy");
    expect(m.text).toContain("Subtotal $14.70");
    expect(m.text).toContain("Pearls were hard");
  });

  it("plaintext body shows phone + email when available", () => {
    const m = buildComplaintEmail(baseInput);
    expect(m.text).toContain("+61412345678");
    expect(m.text).toContain("stan@example.com");
  });

  it("plaintext body shows '(no email on file)' when reply-to is null", () => {
    const m = buildComplaintEmail({ ...baseInput, customerEmail: null });
    expect(m.text).toContain("(no email on file)");
  });

  it("attachments are forwarded with filename + base64 content", () => {
    const m = buildComplaintEmail(baseInput);
    expect(m.attachments).toHaveLength(2);
    expect(m.attachments[0]).toEqual({
      filename: "photo-1.jpg",
      content: "AAAA",
    });
  });

  it("replyTo is set when resolveReplyTo returns a real email", () => {
    const m = buildComplaintEmail(baseInput);
    expect(m.replyTo).toBe("stan@example.com");
  });

  it("replyTo is omitted when email is null", () => {
    const m = buildComplaintEmail({ ...baseInput, customerEmail: null });
    expect(m.replyTo).toBeUndefined();
  });

  it("renders '?' for malformed placedAt / closedAt strings", () => {
    const m = buildComplaintEmail({
      ...baseInput,
      placedAt: "not-a-date",
      closedAt: "",
    });
    expect(m.text).toContain("placed ?, completed ?");
  });
});
