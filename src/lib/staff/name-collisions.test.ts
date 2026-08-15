import { describe, it, expect } from "vitest";
import { ALL_ITEMS } from "./stocklist";

// The safety argument behind near-miss matching, checked against the list
// rather than assumed.
//
// Voice counting accepts a name heard one letter wrong, but only for names of
// five characters or more. That is safe exactly while no two such names are
// closer than three edits apart: at distance three, a word within one edit of
// one name cannot also be within one edit of another, because that would put
// the two names within two of each other.
//
// So this file is the precondition. Add an item that breaks it and voice
// counting could start writing a number against the wrong bottle — which is
// the one thing it must never do. The test fails first.

const FUZZY_MIN_LENGTH = 5;
const FUZZY_MAX_EDITS = 1;
/** Two names must differ by more than twice the edits allowed. */
const REQUIRED_DISTANCE = FUZZY_MAX_EDITS * 2 + 1;

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i, ...new Array<number>(b.length).fill(0)];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

const names = [...new Set(ALL_ITEMS.map((i) => i.name.toLowerCase()))];

describe("item names the voice matcher has to tell apart", () => {
  it("keeps every fuzzy-matchable name far enough from every other", () => {
    const fuzzy = names.filter((n) => n.length >= FUZZY_MIN_LENGTH);
    const tooClose: string[] = [];
    for (let i = 0; i < fuzzy.length; i++) {
      for (let j = i + 1; j < fuzzy.length; j++) {
        const d = editDistance(fuzzy[i], fuzzy[j]);
        if (d < REQUIRED_DISTANCE) tooClose.push(`"${fuzzy[i]}" vs "${fuzzy[j]}" (${d})`);
      }
    }
    expect(tooClose, `too close for one-edit matching: ${tooClose.join("; ")}`).toEqual([]);
  });

  it("leaves the short names out of fuzzy matching, because they collide", () => {
    // PF, PA, GF and GA are mutually one edit apart and LYMT is two from LIME.
    // This asserts the danger is real, so the length floor is not mistaken for
    // caution that could be relaxed later.
    const short = names.filter((n) => n.length < FUZZY_MIN_LENGTH);
    const collisions = short.flatMap((a) =>
      short.filter((b) => b !== a && editDistance(a, b) <= FUZZY_MAX_EDITS).map((b) => `${a}/${b}`),
    );
    expect(collisions.length).toBeGreaterThan(0);
  });
});
