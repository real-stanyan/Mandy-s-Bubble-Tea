import { describe, expect, it } from "vitest";
import { buildPaymentSelections } from "./build-payment-selections";
import type { CupLabelSelection } from "@/store/cart";

describe("buildPaymentSelections", () => {
  it("returns empty maps when no selections", () => {
    expect(buildPaymentSelections({})).toEqual({
      presetStickerHashes: undefined,
      aiDoodleIds: undefined,
      doodleIds: undefined,
    });
  });

  it("routes preset → presetStickerHashes", () => {
    const sel: Record<string, CupLabelSelection> = {
      "A:0": { kind: "preset", hash: "hash1" },
      "A:1": { kind: "preset", hash: "hash2" },
    };
    expect(buildPaymentSelections(sel)).toEqual({
      presetStickerHashes: { "A:0": "hash1", "A:1": "hash2" },
      aiDoodleIds: undefined,
      doodleIds: undefined,
    });
  });

  it("routes photo + ai → aiDoodleIds (same map, server-side identical)", () => {
    const sel: Record<string, CupLabelSelection> = {
      "A:0": { kind: "photo", uploadedDoodleId: "photo-id", previewUrl: "u" },
      "A:1": { kind: "ai", aiDoodleId: "ai-id", prompt: "p" },
    };
    expect(buildPaymentSelections(sel)).toEqual({
      presetStickerHashes: undefined,
      aiDoodleIds: { "A:0": "photo-id", "A:1": "ai-id" },
      doodleIds: undefined,
    });
  });

  it("routes draw → doodleIds (separate bucket from photo/ai)", () => {
    const sel: Record<string, CupLabelSelection> = {
      "A:0": { kind: "draw", userDoodleId: "draw-id", pathCount: 7 },
    };
    expect(buildPaymentSelections(sel)).toEqual({
      presetStickerHashes: undefined,
      aiDoodleIds: undefined,
      doodleIds: { "A:0": "draw-id" },
    });
  });

  it("splits a mixed cart into three parallel maps", () => {
    const sel: Record<string, CupLabelSelection> = {
      "A:0": { kind: "preset", hash: "h" },
      "A:1": { kind: "photo", uploadedDoodleId: "p-id", previewUrl: "u" },
      "A:2": { kind: "ai", aiDoodleId: "a-id", prompt: "p" },
      "A:3": { kind: "draw", userDoodleId: "d-id", pathCount: 3 },
    };
    expect(buildPaymentSelections(sel)).toEqual({
      presetStickerHashes: { "A:0": "h" },
      aiDoodleIds: { "A:1": "p-id", "A:2": "a-id" },
      doodleIds: { "A:3": "d-id" },
    });
  });

  it("skips AI entries whose submission is still pending (aiDoodleId=null)", () => {
    const sel: Record<string, CupLabelSelection> = {
      "A:0": { kind: "ai", aiDoodleId: null, prompt: "still working" },
      "A:1": { kind: "preset", hash: "h" },
    };
    expect(buildPaymentSelections(sel)).toEqual({
      presetStickerHashes: { "A:1": "h" },
      aiDoodleIds: undefined,
      doodleIds: undefined,
    });
  });

  it("skips draw entries whose upload is still pending (userDoodleId=null)", () => {
    const sel: Record<string, CupLabelSelection> = {
      "A:0": { kind: "draw", userDoodleId: null, pathCount: 4 },
      "A:1": { kind: "preset", hash: "h" },
    };
    expect(buildPaymentSelections(sel)).toEqual({
      presetStickerHashes: { "A:1": "h" },
      aiDoodleIds: undefined,
      doodleIds: undefined,
    });
  });
});
