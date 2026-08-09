import { describe, expect, it } from "vitest";
import {
  MEMORY_STAMP_STYLE_ID,
  MEMORY_STAMP_LABEL,
  buildMemoryStampPrompt,
} from "./stamp-style";

/**
 * The rule this pins: the Memory Stamp prompt must keep the promises the
 * medium depends on. A thermal head prints solid black or nothing, so the
 * prompt has to forbid everything that only survives as grey; and the whole
 * point of stamping YOUR photo is that the subject stays yours, so the
 * identity locks from the source skill must never be edited away.
 */

describe("buildMemoryStampPrompt", () => {
  const prompt = buildMemoryStampPrompt();

  it("demands pure black-on-white — the printer has no grey", () => {
    expect(prompt).toMatch(/solid black ink/i);
    expect(prompt).toMatch(/pure white background/i);
    expect(prompt).toMatch(/no gradients/i);
  });

  it("keeps the white ground clean — the sticker itself is the paper", () => {
    expect(prompt).toMatch(/white background completely clean/i);
    expect(prompt).toMatch(/no halftone/i);
  });

  it("demands coarse wear, not fine noise — grain turns to mush at 5cm", () => {
    expect(prompt).toMatch(/dry-brush/i);
    expect(prompt).toMatch(/large scale/i);
    expect(prompt).toMatch(/never fine speckle/i);
  });

  it("keeps the source skill's identity locks", () => {
    expect(prompt).toMatch(/identity/i);
    expect(prompt).toMatch(/same pose/i);
    expect(prompt).toMatch(/preserve the face/i);
    expect(prompt).toMatch(/do not add, remove, duplicate or replace/i);
  });

  it("keeps the stamp physics that make it read as a stamp", () => {
    expect(prompt).toMatch(/ink wear/i);
    expect(prompt).toMatch(/uneven ink pressure/i);
  });

  it("never lets the caption transcribe its own instructions", () => {
    // The UPPER 1-3 incident: instruction fragments became the caption.
    expect(prompt).toMatch(/never write any instruction wording or any numbers/i);
    expect(prompt).not.toMatch(/\d/);
  });

  it("is square-composed for the square sticker", () => {
    expect(prompt).toMatch(/square composition/i);
  });

  it("exposes stable ids the client and route agree on", () => {
    expect(MEMORY_STAMP_STYLE_ID).toBe("memory-stamp");
    expect(MEMORY_STAMP_LABEL).toBe("Memory Stamp");
  });
});
