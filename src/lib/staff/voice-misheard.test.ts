import { describe, it, expect } from "vitest";
import { parseVoiceCounts } from "./voice-count";

// The two things the shop actually reported: numbers that came back as
// ordinary words, and a mis-heard long name filling the short one instead.

const say = (t: string) => parseVoiceCounts(t).matched.map((m) => `${m.item.id}=${m.value}`);

describe("numbers the recogniser writes as words", () => {
  it("hears 'to' as two", () => {
    // Verbatim from the shop: "Aloe Vera two" came back as "aloe vera to",
    // the name matched, no number was found, and the row stayed blank while
    // the screen said "no number heard".
    expect(say("aloe vera to")).toEqual(["topping-aloe-vera=2"]);
    expect(say("mango too")).toEqual(["syrup-mango=2"]);
  });

  it("hears the other common ones", () => {
    expect(say("mango for")).toEqual(["syrup-mango=4"]);
    expect(say("mango free")).toEqual(["syrup-mango=3"]);
    expect(say("mango ate")).toEqual(["syrup-mango=8"]);
    expect(say("mango won")).toEqual(["syrup-mango=1"]);
  });

  it("prefers a real number over a homophone in the same breath", () => {
    // "for" is ordinary English. It must not beat an actual number.
    expect(say("mango for three")).toEqual(["syrup-mango=3"]);
  });
});

describe("a longer name misheard as the shorter one", () => {
  it("will not fill the syrup when the jelly was meant", () => {
    // "lychee jelly" mis-transcribed is two edits away — past the near-miss
    // pass — and the scan used to drop to "leechee" and fill the SYRUP,
    // leaving the jelly blank and a number on a bottle nobody counted.
    const out = parseVoiceCounts("leechee jelly to");
    expect(out.matched).toEqual([]);
    expect(out.ambiguous.join(" ")).toMatch(/Lychee/);
  });

  it("fills the jelly when the jelly was heard properly", () => {
    expect(say("lychee jelly to")).toEqual(["topping-lychee-jelly=2"]);
  });

  it("still fills the plain one when a number follows it", () => {
    expect(say("lychee to")).toEqual(["syrup-lychee=2"]);
    expect(say("mango three")).toEqual(["syrup-mango=3"]);
  });

  it("holds for the other prefix pairs on the list", () => {
    expect(say("mango jelly two")).toEqual(["topping-mango-jelly=2"]);
    expect(parseVoiceCounts("mango jelli two").matched).toEqual([
      expect.objectContaining({ item: expect.objectContaining({ id: "topping-mango-jelly" }) }),
    ]);
  });
});
