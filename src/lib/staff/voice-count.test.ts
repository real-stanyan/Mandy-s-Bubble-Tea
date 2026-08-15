import { describe, it, expect } from "vitest";
import { parseVoiceCounts } from "./voice-count";

const ids = (t: string) => parseVoiceCounts(t).matched.map((m) => `${m.item.id}=${m.value}`);

describe("parsing a spoken stock count", () => {
  it("reads the way someone actually walks a shelf", () => {
    // No commas, no pauses — this is what continuous recognition returns.
    expect(ids("mango three peach five lychee two")).toEqual([
      "syrup-mango=3",
      "syrup-peach=5",
      "syrup-lychee=2",
    ]);
  });

  it("reads digits as readily as words", () => {
    expect(ids("mango 3, peach 5")).toEqual(["syrup-mango=3", "syrup-peach=5"]);
  });

  it("takes the longer name when one contains another", () => {
    // "Brown Sugar" sits inside "Tiger Brown Sugar"; the wrong one here is a
    // number written against a bottle nobody looked at.
    expect(ids("tiger brown sugar two")).toEqual(["syrup-tiger-brown-sugar=2"]);
    expect(ids("brown sugar four")).toEqual(["syrup-brown-sugar=4"]);
  });

  it("handles abbreviations spoken letter by letter", () => {
    // Recognisers hand back "p f" and "l y m t" far more often than "PF".
    expect(ids("p f two, g a one")).toEqual(["syrup-pf=2", "syrup-ga=1"]);
    expect(ids("lymt three")).toEqual(["syrup-lymt=3"]);
  });

  it("does not match an item name inside a longer word", () => {
    // "pa" must not fire on "papaya".
    expect(parseVoiceCounts("papaya three").matched).toEqual([]);
  });

  it("takes decimals, since the keypad has a dot", () => {
    expect(ids("matcha 1.5")).toEqual(["powder-matcha=1.5"]);
  });
});

describe("the two items that share a name", () => {
  it("refuses to guess between the syrup and the other", () => {
    // Lemon and Orange each exist twice. Guessing writes a number against the
    // wrong bottle, so this stays blank and says so.
    const out = parseVoiceCounts("lemon three");
    expect(out.matched).toEqual([]);
    expect(out.ambiguous).toContain("lemon");
  });

  it("accepts a category said either side of the name", () => {
    expect(ids("syrup lemon three")).toEqual(["syrup-lemon=3"]);
    expect(ids("lemon syrup three")).toEqual(["syrup-lemon=3"]);
  });
});

describe("enough / maybe / short items", () => {
  it("reads the words people say at a counter", () => {
    expect(ids("cups enough, straws not enough")).toEqual([
      "packaging-cups=enough",
      "packaging-straws=short",
    ]);
  });

  it("reads a hedge as maybe, but only when hedged on purpose", () => {
    expect(ids("cups maybe")).toEqual(["packaging-cups=maybe"]);
    expect(ids("cups plenty")).toEqual(["packaging-cups=enough"]);
  });

  it("treats a bare zero as short, because nobody counts zero and means fine", () => {
    expect(ids("cups zero")).toEqual(["packaging-cups=short"]);
  });
});

describe("what it refuses to do", () => {
  it("says nothing rather than inventing a value", () => {
    const out = parseVoiceCounts("mango peach five");
    // Mango has no number before Peach starts, so it is reported as unanswered
    // rather than quietly handed Peach's five.
    expect(out.matched.map((m) => `${m.item.id}=${m.value}`)).toEqual(["syrup-peach=5"]);
    expect(out.missingValue).toContain("Mango");
  });

  it("ignores everything it does not recognise", () => {
    // Shop noise, half-sentences, someone talking to a customer.
    expect(parseVoiceCounts("um hang on sorry what was that").matched).toEqual([]);
  });

  it("keeps the first answer when an item is said twice", () => {
    expect(ids("mango three mango nine")).toEqual(["syrup-mango=3"]);
  });

  it("returns nothing at all for an empty transcript", () => {
    expect(parseVoiceCounts("")).toEqual({ matched: [], ambiguous: [], missingValue: [] });
  });
});

describe("the abbreviations on the shelf labels", () => {
  const say = (t: string) => parseVoiceCounts(t).matched.map((m) => `${m.item.id}=${m.value}`);

  it("takes the words people say instead of the letters", () => {
    // Rick supplied these: PF is passion fruit, GA green apple, GF grapefruit,
    // LYMT lychee milk tea. Nobody says "P F" at a shelf.
    expect(say("passion fruit three")).toEqual(["syrup-pf=3"]);
    expect(say("green apple two")).toEqual(["syrup-ga=2"]);
    expect(say("grapefruit one")).toEqual(["syrup-gf=1"]);
    expect(say("lychee milk tea four")).toEqual(["syrup-lymt=4"]);
  });

  it("still takes the letters, since the labels say the letters", () => {
    expect(say("p f three")).toEqual(["syrup-pf=3"]);
  });

  it("does not let lychee milk tea collapse into plain lychee", () => {
    // "Lychee" is its own syrup and sits inside the longer name.
    expect(say("lychee milk tea four lychee two")).toEqual([
      "syrup-lymt=4",
      "syrup-lychee=2",
    ]);
  });

  it("takes pineapple for PA", () => {
    expect(say("pineapple two")).toEqual(["syrup-pa=2"]);
    expect(say("p a two")).toEqual(["syrup-pa=2"]);
  });

  it("still does not match a name nobody has defined", () => {
    // The table is the only source of expansions. An abbreviation Rick has not
    // explained stays unmatched rather than being guessed at.
    expect(say("papaya three")).toEqual([]);
  });
});

describe("bugs found by reading real output", () => {
  const say = (t: string) => parseVoiceCounts(t).matched.map((m) => `${m.item.id}=${m.value}`);

  it("resolves both Lemons in one sentence", () => {
    // The Others category has id "others" while its items are "other-lemon",
    // so testing the id prefix never matched and this stayed ambiguous.
    expect(say("syrup lemon three others lemon one")).toEqual([
      "syrup-lemon=3",
      "other-lemon=1",
    ]);
  });

  it("hears half a bottle as half a bottle", () => {
    // "three point five" was silently becoming 3. The keypad has a decimal
    // point because half bottles are a real answer.
    expect(say("mango three point five")).toEqual(["syrup-mango=3.5"]);
    expect(say("mango 3.5")).toEqual(["syrup-mango=3.5"]);
  });

  it("does not turn a following item into a fraction", () => {
    expect(say("mango three peach five")).toEqual(["syrup-mango=3", "syrup-peach=5"]);
  });
});
