import { describe, it, expect } from "vitest";
import { buildSeedRows } from "./lib/seed-gallery-presets";

describe("buildSeedRows", () => {
  it("maps hashes to builtin/static rows with ascending sort_order", () => {
    const rows = buildSeedRows(["aaa", "bbb"]);
    expect(rows).toEqual([
      { hash: "aaa", source: "builtin", storage: "static", hidden: false, sort_order: 0 },
      { hash: "bbb", source: "builtin", storage: "static", hidden: false, sort_order: 1 },
    ]);
  });
});
