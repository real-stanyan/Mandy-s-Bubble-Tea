import { describe, it, expect } from "vitest";
import { buildPaymentRequestBody } from "./payment-request";
import type { CupLabelSelection } from "@/store/cart";

// Regression guard for the 2026-05-24 OL829 bug: the cart drawer's
// wallet-pay handler built its /api/payment body by hand and forgot to
// forward the per-cup label selections, so every customised cup paid via
// Apple/Google Pay in the drawer fell back to a random tarot card
// server-side. Both pay paths (drawer + /checkout) now go through this
// single builder so the selections can never be dropped by one caller
// while the other keeps them.

describe("buildPaymentRequestBody", () => {
  it("carries the base payment fields through verbatim", () => {
    const body = buildPaymentRequestBody({
      sourceId: "cnon:card-nonce",
      orderId: "ORDER123",
      verificationToken: "verif-tok",
      labelSelections: {},
    });
    expect(body.sourceId).toBe("cnon:card-nonce");
    expect(body.orderId).toBe("ORDER123");
    expect(body.verificationToken).toBe("verif-tok");
  });

  it("forwards a photo selection into aiDoodleIds keyed by the cup slot", () => {
    const selections: Record<string, CupLabelSelection> = {
      "VAR::MOD:0": {
        kind: "photo",
        uploadedDoodleId: "6512ca90-aa2a-4a6d-9b71-c5b3b5631fdb",
        previewUrl: "https://example.test/p.png",
      },
    };
    const body = buildPaymentRequestBody({
      sourceId: "cnon:x",
      orderId: "ORDER123",
      labelSelections: selections,
    });
    expect(body.aiDoodleIds).toEqual({
      "VAR::MOD:0": "6512ca90-aa2a-4a6d-9b71-c5b3b5631fdb",
    });
  });

  it("splits preset / photo / draw across the three parallel maps", () => {
    const selections: Record<string, CupLabelSelection> = {
      "A:0": { kind: "preset", hash: "abc123" },
      "B:0": {
        kind: "photo",
        uploadedDoodleId: "photo-id",
        previewUrl: "u",
      },
      "C:0": { kind: "draw", userDoodleId: "draw-id", pathCount: 3 },
    };
    const body = buildPaymentRequestBody({
      sourceId: "cnon:x",
      orderId: "O",
      labelSelections: selections,
    });
    expect(body.presetStickerHashes).toEqual({ "A:0": "abc123" });
    expect(body.aiDoodleIds).toEqual({ "B:0": "photo-id" });
    expect(body.doodleIds).toEqual({ "C:0": "draw-id" });
  });

  it("leaves selection maps undefined when there is no choice (server falls back)", () => {
    const body = buildPaymentRequestBody({
      sourceId: "cnon:x",
      orderId: "O",
      labelSelections: {},
    });
    expect(body.presetStickerHashes).toBeUndefined();
    expect(body.aiDoodleIds).toBeUndefined();
    expect(body.doodleIds).toBeUndefined();
  });
});

describe("buildPaymentRequestBody — keepLabelCopy", () => {
  it("forwards keepLabelCopy into the body", () => {
    const body = buildPaymentRequestBody({
      orderId: "ORD1",
      labelSelections: {},
      keepLabelCopy: true,
    });
    expect(body.keepLabelCopy).toBe(true);
  });

  it("defaults keepLabelCopy to false when omitted", () => {
    const body = buildPaymentRequestBody({ orderId: "ORD1", labelSelections: {} });
    expect(body.keepLabelCopy).toBe(false);
  });
});
