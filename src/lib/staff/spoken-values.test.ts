import { describe, it, expect } from "vitest";
import { parseSpokenValues } from "./spoken-values";

const vals = (t: string) =>
  parseSpokenValues(t).map((v) => (v.kind === "skip" ? "skip" : v.value));

describe("reading a spoken count", () => {
  it("takes a run of numbers in the order they were said", () => {
    // One breath, several rows. The screen says which item each belongs to.
    expect(vals("three two five one")).toEqual(["3", "2", "5", "1"]);
    expect(vals("3 2 5 1")).toEqual(["3", "2", "5", "1"]);
  });

  it("takes the words the recogniser actually returns", () => {
    // Both reported from the shop. With no item names in the utterance there
    // is nothing for these to be confused with, so they are simply numbers.
    expect(vals("too")).toEqual(["2"]);
    expect(vals("bun")).toEqual(["1"]);
    expect(vals("for free ate")).toEqual(["4", "3", "8"]);
  });

  it("hears the iPhone wake word as three", () => {
    // Reported from the shop: the phone hears its own name in "three".
    // Nothing phonetic catches this — "siri" and "three" share no consonants.
    expect(vals("siri")).toEqual(["3"]);
    expect(vals("too siri bun")).toEqual(["2", "3", "1"]);
  });

  it('hears "hey" as eight, which distance alone got wrong', () => {
    // Also from the shop, and worse than unheard: "hey" is two edits from
    // "ten" and four from "eight", so the near-miss pass was quietly writing a
    // 10 every time somebody said eight.
    expect(vals("hey")).toEqual(["8"]);
    expect(vals("hay")).toEqual(["8"]);
    // Still a hesitation, not a number — half the sentences here end in it.
    expect(vals("eh")).toEqual([]);
    // And the real tens are untouched.
    expect(vals("ten tan tin")).toEqual(["10", "10", "10"]);
  });

  it("strips the leading zero that showed up as 02 in a row", () => {
    expect(vals("02")).toEqual(["2"]);
    expect(vals("007")).toEqual(["7"]);
  });

  it("takes halves, since the keypad has a decimal point", () => {
    expect(vals("three point five")).toEqual(["3.5"]);
    expect(vals("1.5")).toEqual(["1.5"]);
    expect(vals("half")).toEqual(["0.5"]);
  });

  it("reads Chinese numbers, including 两", () => {
    expect(vals("三二一")).toEqual(["3", "2", "1"]);
    expect(vals("两")).toEqual(["2"]);
    expect(vals("三点五")).toEqual(["3.5"]);
  });

  it("reads Korean numbers, native and Sino", () => {
    expect(vals("하나 둘 셋")).toEqual(["1", "2", "3"]);
    expect(vals("일 이 삼")).toEqual(["1", "2", "3"]);
  });

  it("reads the enough/maybe/short answers for cups and straws", () => {
    expect(vals("enough")).toEqual(["enough"]);
    expect(vals("not enough")).toEqual(["short"]);
    expect(vals("maybe")).toEqual(["maybe"]);
    expect(vals("够")).toEqual(["enough"]);
    expect(vals("不够")).toEqual(["short"]);
  });

  it("takes a spoken skip, because blank is a real answer", () => {
    expect(vals("three skip two")).toEqual(["3", "skip", "2"]);
    expect(vals("跳过")).toEqual(["skip"]);
  });

  it("ignores everything else without inventing a value", () => {
    expect(vals("um hang on sorry")).toEqual([]);
    expect(vals("")).toEqual([]);
  });
});

describe("walking the list with what was heard", () => {
  // The rule the form applies: each value lands on the lit row, then the
  // cursor moves on. Kept here because it is the part that decides which
  // bottle a number ends up against.
  type Item = { id: string; sufficiency?: boolean };
  function walk(items: Item[], startId: string, transcript: string) {
    const spoken = parseSpokenValues(transcript);
    let at = Math.max(0, items.findIndex((i) => i.id === startId));
    const counts: Record<string, string> = {};
    for (const v of spoken) {
      const item = items[at];
      if (!item) break;
      if (v.kind === "skip") {
        at += 1;
        continue;
      }
      const written = item.sufficiency
        ? v.kind === "sufficiency"
          ? v.value
          : Number(v.value) === 0
            ? "short"
            : "enough"
        : v.kind === "number"
          ? v.value
          : "";
      if (written) counts[item.id] = written;
      at += 1;
    }
    return { counts, landed: items[Math.min(at, items.length - 1)]?.id };
  }

  const list: Item[] = [
    { id: "mango" },
    { id: "peach" },
    { id: "lychee" },
    { id: "cups", sufficiency: true },
  ];

  it("puts each number on the next row down", () => {
    expect(walk(list, "mango", "three too bun enough")).toEqual({
      counts: { mango: "3", peach: "2", lychee: "1", cups: "enough" },
      landed: "cups",
    });
  });

  it("leaves a skipped row blank and keeps going", () => {
    // Blank means "not counted", which is a real answer and must survive.
    expect(walk(list, "mango", "three skip five").counts).toEqual({
      mango: "3",
      lychee: "5",
    });
  });

  it("starts from whichever row is lit, not the top", () => {
    expect(walk(list, "lychee", "four").counts).toEqual({ lychee: "4" });
  });

  it("reads a number said against cups as an answer, not a count", () => {
    expect(walk(list, "cups", "zero").counts).toEqual({ cups: "short" });
    expect(walk(list, "cups", "five").counts).toEqual({ cups: "enough" });
  });

  it("stops at the end rather than wrapping to the top", () => {
    // Wrapping would silently overwrite the count that was already taken.
    expect(walk(list, "cups", "enough three two").counts).toEqual({ cups: "enough" });
  });
});

describe("pulling a stray word to the nearest number", () => {
  it("takes words that are nearly a number", () => {
    // Patching these one report at a time was never going to end: the shop
    // found "too", "bun", "siri" and "no" in four days, and each dropped a
    // count on the floor until it was named.
    expect(vals("mine wine")).toEqual(["9", "9"]);
    expect(vals("tan")).toEqual(["10"]);
    expect(vals("sever")).toEqual(["7"]);
  });

  it("leaves the words that hold a sentence together alone", () => {
    // The dangerous ones, found by printing what the pass did to forty
    // ordinary words. "and" lands on one and "done" lands on one, and either
    // inserted mid-count shifts every value after it down a row — a whole
    // shelf recorded against the wrong bottles.
    expect(vals("and")).toEqual([]);
    expect(vals("done")).toEqual([]);
    expect(vals("more")).toEqual([]);
    expect(vals("then")).toEqual([]);
    expect(vals("okay")).toEqual([]);
  });

  it("ignores noise rather than reaching for a number", () => {
    expect(vals("um uh hmm sorry yeah what")).toEqual([]);
  });

  it("does not stretch to a word that is nothing like a number", () => {
    expect(vals("mango")).toEqual([]);
    expect(vals("strawberry")).toEqual([]);
  });

  it("refuses a word that is equally close to two numbers", () => {
    // Equidistant is not evidence of either.
    expect(vals("nan")).toEqual([]);
  });
});
