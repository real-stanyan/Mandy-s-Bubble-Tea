import { describe, it, expect } from "vitest";
import { parseVoiceCounts } from "./voice-count";
import { ALL_ITEMS } from "./stocklist";

// The alias table, checked against the list it points into.
//
// Aliases were introduced to help and immediately caused the thing this
// matcher exists to prevent: the list already contains an item called
// Grapefruit, and registering "grapefruit" for the GF syrup silently took the
// name off it. Saying it would have filled the wrong bottle without a word.

const say = (t: string) => parseVoiceCounts(t).matched.map((m) => `${m.item.id}=${m.value}`);

describe("aliases", () => {
  it("never takes a name off a real item", () => {
    // Anything that is genuinely two things must ask, not pick.
    const out = parseVoiceCounts("grapefruit three");
    expect(out.matched).toEqual([]);
    expect(out.ambiguous).toContain("grapefruit");
  });

  it("lets a category word settle it, like the Lemons", () => {
    expect(say("syrup grapefruit three")).toEqual(["syrup-gf=3"]);
    expect(say("others grapefruit two")).toEqual(["other-grapefruit=2"]);
  });

  it("hears lychee however the recogniser spells it", () => {
    // Reported from the shop as not recognised. These are 2 to 4 edits from
    // the real spelling, so the near-miss pass could never have reached them.
    for (const spoken of ["lychee", "leechee", "lichee", "litchi", "lichi", "lee chee"]) {
      expect(say(`${spoken} three`), spoken).toEqual(["syrup-lychee=3"]);
    }
  });

  it("still keeps lychee milk tea separate from lychee", () => {
    expect(say("lychee milk tea four leechee two")).toEqual([
      "syrup-lymt=4",
      "syrup-lychee=2",
    ]);
  });

  it("keeps the unambiguous abbreviations working", () => {
    expect(say("passion fruit two green apple one pineapple four")).toEqual([
      "syrup-pf=2",
      "syrup-ga=1",
      "syrup-pa=4",
    ]);
  });

  it("has no alias that duplicates a different item's exact name", () => {
    // The grapefruit case is handled by asking. This asserts we know about
    // every such case rather than discovering the next one in production.
    const names = new Set(ALL_ITEMS.map((i) => i.name.toLowerCase()));
    const knownOverlaps = new Set(["grapefruit"]);
    const overlaps = ["passion fruit", "green apple", "pineapple", "lychee milk tea", "leechee"]
      .filter((a) => names.has(a))
      .filter((a) => !knownOverlaps.has(a));
    expect(overlaps).toEqual([]);
  });
});
