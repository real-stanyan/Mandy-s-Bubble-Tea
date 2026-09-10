import { describe, expect, it } from "vitest";
import { composeSpecials } from "./specials";
import { renderTemplate } from "./campaigns";

describe("composeSpecials", () => {
  it("one price for the shelf reads as a single offer with the old price", () => {
    const d = composeSpecials(
      [
        { name: "Strawberry Slushy", priceCents: 460, originalCents: 620 },
        { name: "Guava Iced Green Tea", priceCents: 460, originalCents: 620 },
      ],
      [],
    );
    expect(d.itemsText).toBe("Strawberry Slushy & Guava Iced Green Tea");
    expect(d.priceText).toBe("now $4.60 (was $6.20)");
    expect(renderTemplate("{items} — {price}.", { items: d.itemsText, price: d.priceText })).toBe(
      "Strawberry Slushy & Guava Iced Green Tea — now $4.60 (was $6.20).",
    );
  });

  it("mixed prices list each drink and quote the lowest", () => {
    const d = composeSpecials(
      [
        { name: "Guava Slushy", priceCents: 480, originalCents: 620 },
        { name: "Guava Iced Green Tea", priceCents: 460, originalCents: 620 },
        { name: "Blueberry Cheese", priceCents: 600, originalCents: 750 },
      ],
      [],
    );
    expect(d.itemsText).toBe("Guava Slushy $4.80, Guava Iced Green Tea $4.60 & Blueberry Cheese $6.00");
    expect(d.priceText).toBe("from $4.60");
  });

  it("the fingerprint follows the live price, not the wording", () => {
    const a = composeSpecials([{ name: "Guava Slushy", priceCents: 480, originalCents: 620 }], []);
    const b = composeSpecials([{ name: "guava  slushy", priceCents: 480, originalCents: 620 }], []);
    const c = composeSpecials([{ name: "Guava Slushy", priceCents: 620, originalCents: 620 }], []);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
    // Back at list price: no "was" to quote.
    expect(c.priceText).toBe("now $6.20");
  });

  it("an empty shelf drafts nothing and keeps the missing names", () => {
    const d = composeSpecials([], ["Pineapple Black Tea"]);
    expect(d.itemsText).toBe("");
    expect(d.missing).toEqual(["Pineapple Black Tea"]);
  });
});
