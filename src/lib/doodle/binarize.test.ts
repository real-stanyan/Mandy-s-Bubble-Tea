// src/lib/doodle/binarize.test.ts
import { describe, it, expect, afterEach } from "vitest";
import sharp from "sharp";
import {
  binarizeForThermal,
  isDarkSource,
  needsShadowRecovery,
} from "./binarize";

async function solidGray(level: number, w = 200, h = 200): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 3, level);
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

// Mimics a night photo: a big dark background spike plus a small bright
// highlight (phone flash / streetlight), so a naive min/max stretch has
// little room to lift the shadow-heavy midtones.
async function nightPhoto(w = 200, h = 200): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 3, 15);
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      const i = (y * w + x) * 3;
      buf[i] = buf[i + 1] = buf[i + 2] = 250;
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

// The failure class the mean-only rule missed: a correctly-exposed bright
// subject filling ~half the frame against a deep-shadow background. The mean
// lands well above DARK_MEAN_THRESHOLD, so routing on brightness alone sends
// it to v1 and the background prints as one black slab.
async function brightSubjectOnBlack(w = 200, h = 200): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 3, 20);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w / 2; x++) {
      const i = (y * w + x) * 3;
      buf[i] = buf[i + 1] = buf[i + 2] = 230;
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

async function blackRatio(png: Buffer): Promise<number> {
  const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let black = 0;
  for (const px of data) if (px === 0) black++;
  return black / data.length;
}

const ORIGINAL_PIPELINE = process.env.BINARIZE_PIPELINE;
afterEach(() => {
  if (ORIGINAL_PIPELINE === undefined) delete process.env.BINARIZE_PIPELINE;
  else process.env.BINARIZE_PIPELINE = ORIGINAL_PIPELINE;
});

describe("isDarkSource", () => {
  it("flags a dark/underexposed source", async () => {
    expect(await isDarkSource(await nightPhoto())).toBe(true);
    expect(await isDarkSource(await solidGray(20))).toBe(true);
  });

  it("does not flag a normally-lit source", async () => {
    expect(await isDarkSource(await solidGray(150))).toBe(false);
  });

  it("fails safe (false) on unreadable input", async () => {
    expect(await isDarkSource(Buffer.from("not an image"))).toBe(false);
  });
});

describe("needsShadowRecovery", () => {
  it("flags a globally underexposed source, same as isDarkSource", async () => {
    expect(await needsShadowRecovery(await nightPhoto())).toBe(true);
  });

  it("flags a bright subject on a deep-shadow background that the mean alone misses", async () => {
    const src = await brightSubjectOnBlack();
    // Precondition: this is exactly the case the old rule let through.
    expect(await isDarkSource(src)).toBe(false);
    expect(await needsShadowRecovery(src)).toBe(true);
  });

  it("leaves an evenly-lit source alone", async () => {
    expect(await needsShadowRecovery(await solidGray(150))).toBe(false);
  });

  it("fails safe (false) on unreadable input", async () => {
    expect(await needsShadowRecovery(Buffer.from("not an image"))).toBe(false);
  });
});

// ── v3 fixtures: the "some dark area" class ─────────────────────────────────

// Normally-lit scene with one large shaded dark region (a black dress, a dark
// car body) covering 16% of the frame — under the 25% shadow-mass rule, so it
// never reaches the CLAHE route. Before v3 this printed as one black slab.
// The region ramps 8 → 56 left→right with 8-px "folds" (±8) riding on the
// ramp, so it carries the kind of shading a fabric or a car body has; a
// perfectly smooth synthetic gradient reads as a flat fill at 592 px.
async function shadedDarkRegionOnLight(w = 200, h = 200): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 3, 200);
  for (let y = 60; y < 140; y++) {
    for (let x = 60; x < 140; x++) {
      const fold = Math.floor((x - 60) / 8) % 2 === 0 ? -8 : 8;
      const v = 16 + Math.round(((x - 60) / 79) * 32) + fold;
      const i = (y * w + x) * 3;
      buf[i] = buf[i + 1] = buf[i + 2] = v;
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

// Same footprint, but a flat fill — a logo block, a stamp's sky. Intentional
// ink that has nothing to reveal and must keep printing solid.
async function flatBlackBlockOnLight(w = 200, h = 200): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 3, 200);
  for (let y = 60; y < 140; y++) {
    for (let x = 60; x < 140; x++) {
      const i = (y * w + x) * 3;
      buf[i] = buf[i + 1] = buf[i + 2] = 0;
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

// 3-px black grid on white: line art, thinner than the lift's opening radius.
async function thinLineArt(w = 200, h = 200): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 3, 255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x % 20 < 3 || y % 20 < 3) {
        const i = (y * w + x) * 3;
        buf[i] = buf[i + 1] = buf[i + 2] = 0;
      }
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

// Black ratio inside a window of the 592×592 output, output coordinates.
async function blackRatioIn(
  png: Buffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<number> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let black = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (data[(y * info.width + x) * info.channels] === 0) black++;
      n++;
    }
  }
  return black / n;
}

// The 80×80 source block lands on output rows/cols 178..414; sample well
// inside it so the feathered edge does not dilute the reading.
const BLOCK = { x0: 200, y0: 200, x1: 392, y1: 392 };

describe("binarizeForThermal v3 — region-aware shadow lift on the default path", () => {
  it("a shaded dark region in a normally-lit photo is NOT the CLAHE route's business", async () => {
    expect(await needsShadowRecovery(await shadedDarkRegionOnLight())).toBe(false);
  });

  it("prints a large shaded dark region with white dots left in it, where v1 printed near-solid", async () => {
    delete process.env.BINARIZE_PIPELINE;
    const src = await shadedDarkRegionOnLight();
    const { binarizeForThermalV1 } = await import("./binarize.v1");

    const v3Black = await blackRatioIn(await binarizeForThermal(src, { mode: "atkinson" }), BLOCK.x0, BLOCK.y0, BLOCK.x1, BLOCK.y1);
    const v1Black = await blackRatioIn(await binarizeForThermalV1(src, { mode: "atkinson" }), BLOCK.x0, BLOCK.y0, BLOCK.x1, BLOCK.y1);

    expect(v1Black).toBeGreaterThan(0.75); // the slab: ~80% nominal → solid after dot gain
    expect(v3Black).toBeLessThan(0.7); // the ink limit holds
    expect(v3Black).toBeLessThan(v1Black - 0.1);
  });

  it("keeps the tonal order inside the lifted region (its darker side still prints darker)", async () => {
    delete process.env.BINARIZE_PIPELINE;
    const out = await binarizeForThermal(await shadedDarkRegionOnLight(), { mode: "atkinson" });
    const left = await blackRatioIn(out, 200, 200, 296, 392);
    const right = await blackRatioIn(out, 296, 200, 392, 392);
    // The lift compresses [0, 128) into [72, 134], so a 16-level source step
    // is worth ~4% coverage; dither noise over an 18k-px window is ~0.4%.
    expect(left).toBeGreaterThan(right + 0.02);
  });

  it("leaves the light surround where v1 had it", async () => {
    delete process.env.BINARIZE_PIPELINE;
    const src = await shadedDarkRegionOnLight();
    const { binarizeForThermalV1 } = await import("./binarize.v1");
    // A band above the block: rows 20..150 are pure surround (200 grey).
    const v3 = await blackRatioIn(await binarizeForThermal(src, { mode: "atkinson" }), 20, 20, 572, 150);
    const v1 = await blackRatioIn(await binarizeForThermalV1(src, { mode: "atkinson" }), 20, 20, 572, 150);
    expect(Math.abs(v3 - v1)).toBeLessThan(0.03);
  });

  it("a flat black graphic fill stays solid — intentional ink is not lifted", async () => {
    delete process.env.BINARIZE_PIPELINE;
    const src = await flatBlackBlockOnLight();
    const { binarizeForThermalV1 } = await import("./binarize.v1");
    const v3 = await blackRatioIn(await binarizeForThermal(src, { mode: "atkinson" }), BLOCK.x0, BLOCK.y0, BLOCK.x1, BLOCK.y1);
    const v1 = await blackRatioIn(await binarizeForThermalV1(src, { mode: "atkinson" }), BLOCK.x0, BLOCK.y0, BLOCK.x1, BLOCK.y1);
    expect(v3).toBeGreaterThan(0.85);
    expect(Math.abs(v3 - v1)).toBeLessThan(0.03);
  });

  it("thin line art keeps v1's tone", async () => {
    delete process.env.BINARIZE_PIPELINE;
    const src = await thinLineArt();
    const { binarizeForThermalV1 } = await import("./binarize.v1");
    const v3 = await blackRatio(await binarizeForThermal(src, { mode: "atkinson" }));
    const v1 = await blackRatio(await binarizeForThermalV1(src, { mode: "atkinson" }));
    expect(Math.abs(v3 - v1)).toBeLessThan(0.01);
  });

  it("BINARIZE_PIPELINE=legacy restores the pre-v3 output byte for byte", async () => {
    process.env.BINARIZE_PIPELINE = "legacy";
    const src = await shadedDarkRegionOnLight();
    const { binarizeForThermalV1 } = await import("./binarize.v1");
    const legacy = await binarizeForThermal(src, { mode: "atkinson" });
    const v1 = await binarizeForThermalV1(src, { mode: "atkinson" });
    expect(legacy.equals(v1)).toBe(true);
  });

  it("BINARIZE_PIPELINE=v1 forces the frozen snapshot even for a shadow-heavy source", async () => {
    process.env.BINARIZE_PIPELINE = "v1";
    const src = await nightPhoto();
    const { binarizeForThermalV1 } = await import("./binarize.v1");
    const forced = await binarizeForThermal(src, { mode: "atkinson" });
    expect(forced.equals(await binarizeForThermalV1(src, { mode: "atkinson" }))).toBe(true);
  });
});

describe("binarizeForThermal auto-dark routing", () => {
  it("keeps a normally-lit photo on the default (v1) path", async () => {
    delete process.env.BINARIZE_PIPELINE;
    const out = await binarizeForThermal(await solidGray(150), { mode: "atkinson" });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(592);
    expect(meta.height).toBe(592);
  });

  it("a night-photo-shaped source prints with meaningfully less black coverage than a naive global stretch", async () => {
    delete process.env.BINARIZE_PIPELINE;
    const src = await nightPhoto();
    const routed = await binarizeForThermal(src, { mode: "atkinson" });
    const routedBlack = await blackRatio(routed);

    // Force the pre-fix behaviour for comparison: v1 unconditionally.
    const { binarizeForThermalV1 } = await import("./binarize.v1");
    const v1Forced = await binarizeForThermalV1(src, { mode: "atkinson" });
    const v1Black = await blackRatio(v1Forced);

    expect(routedBlack).toBeLessThan(v1Black);
  });

  it("a bright-subject-on-black source now prints with less black coverage than v1", async () => {
    delete process.env.BINARIZE_PIPELINE;
    const src = await brightSubjectOnBlack();
    const routedBlack = await blackRatio(
      await binarizeForThermal(src, { mode: "atkinson" }),
    );

    const { binarizeForThermalV1 } = await import("./binarize.v1");
    const v1Black = await blackRatio(
      await binarizeForThermalV1(src, { mode: "atkinson" }),
    );

    expect(routedBlack).toBeLessThan(v1Black);
  });
});
