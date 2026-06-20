import { describe, it, expect, vi } from "vitest";

let mode: "ok" | "throw" = "ok";

vi.mock("@/lib/cup-label/gallery-store", () => ({
  listVisiblePresets: async () => {
    if (mode === "throw") throw new Error("db down");
    return [
      {
        hash: "h1",
        source: "upload",
        thumbUrl: "https://cdn/h1/color.png",
      },
    ];
  },
}));

vi.mock("node:fs/promises", () => ({
  readFile: async () => JSON.stringify({ hashes: ["b1", "b2"] }),
}));

import { GET } from "./route";

describe("GET /api/cup-label/gallery", () => {
  it("returns merged visible presets", async () => {
    mode = "ok";
    const res = await GET();
    expect((await res.json()).presets[0].hash).toBe("h1");
  });

  it("falls back to static manifest on db error", async () => {
    mode = "throw";
    const res = await GET();
    const json = await res.json();
    expect(json.presets.map((p: any) => p.hash)).toEqual(["b1", "b2"]);
    expect(json.presets[0].thumbUrl).toBe("/cup-label/gallery/b1/binarized.png");
  });
});
