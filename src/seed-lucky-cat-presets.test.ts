import { describe, it, expect } from "vitest";
import { buildLuckyCatSeedRows } from "../scripts/seed-lucky-cat-presets";

describe("buildLuckyCatSeedRows", () => {
  it("maps hashes to lucky_cat/builtin/static rows with ascending sort_order", () => {
    expect(buildLuckyCatSeedRows(["aaa", "bbb"])).toEqual([
      { hash: "aaa", source: "builtin", storage: "static", kind: "lucky_cat", hidden: false, sort_order: 0 },
      { hash: "bbb", source: "builtin", storage: "static", kind: "lucky_cat", hidden: false, sort_order: 1 },
    ]);
  });
});
