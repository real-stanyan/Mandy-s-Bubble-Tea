import { describe, expect, it } from "vitest";
import { classifyOrderBlock } from "./order-block";

describe("classifyOrderBlock", () => {
  it("returns null for genuine payment failures (falls back to PaymentErrorDialog)", () => {
    expect(classifyOrderBlock("Card declined")).toBeNull();
    expect(classifyOrderBlock("Payment failed")).toBeNull();
    expect(classifyOrderBlock(null)).toBeNull();
    expect(classifyOrderBlock("")).toBeNull();
  });

  it("classifies the bulk ceiling as a talk-to-a-human dialog with no cart actions", () => {
    const block = classifyOrderBlock(
      "Bulk orders over 50 cups can't be placed online — tell Mandy in the chat (or ring the store) and Rick will be in touch to arrange it.",
    );
    expect(block?.title).toContain("big order");
    expect(block?.body).toContain("Rick");
    expect(block?.canAddItems).toBe(false);
    expect(block?.canSwitchToPickup).toBe(false);
  });

  it("classifies below-minimum with a shortfall and both actions", () => {
    // $9.60 subtotal vs $12 minimum → $2.40 short
    const block = classifyOrderBlock("Below minimum order for delivery", 960n);
    expect(block).not.toBeNull();
    expect(block!.title).toBe("Can't place order");
    expect(block!.body).toContain("$2.40");
    expect(block!.body).toContain("$12");
    expect(block!.canAddItems).toBe(true);
    expect(block!.canSwitchToPickup).toBe(true);
  });

  it("classifies below-minimum without subtotal (generic copy, no shortfall)", () => {
    const block = classifyOrderBlock("Below minimum order for delivery");
    expect(block!.body).toContain("$12");
    expect(block!.body).not.toContain("You're"); // no shortfall phrasing
    expect(block!.canAddItems).toBe(true);
  });

  it("classifies hours / zone / address as pickup-switchable, no add-items", () => {
    for (const msg of [
      "Outside delivery hours",
      "Postcode not in delivery zone",
      "Delivery details missing",
    ]) {
      const block = classifyOrderBlock(msg);
      expect(block, msg).not.toBeNull();
      expect(block!.canSwitchToPickup, msg).toBe(true);
      expect(block!.canAddItems, msg).toBe(false);
    }
  });

  it("is case-insensitive (survives minor wording changes)", () => {
    expect(classifyOrderBlock("BELOW MINIMUM ORDER for delivery")).not.toBeNull();
  });
});
