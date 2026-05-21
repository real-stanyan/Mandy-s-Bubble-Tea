import { describe, expect, it } from "vitest";
import { summaryFor } from "../cup-label-summary";

describe("summaryFor", () => {
  it("renders 'Pick a design' when undefined", () => {
    expect(summaryFor(undefined)).toBe("Pick a design");
  });
  it("renders preset hash prefix", () => {
    expect(summaryFor({ kind: "preset", hash: "abcdef0123" })).toBe("🎨 abcdef01…");
  });
  it("renders photo label", () => {
    expect(
      summaryFor({ kind: "photo", uploadedDoodleId: "id", previewUrl: "u" }),
    ).toBe("📷 Your photo");
  });
  it("truncates AI prompts over 32 chars", () => {
    const prompt = "two cats reading on a moon under stars";
    const out = summaryFor({ kind: "ai", aiDoodleId: "id", prompt });
    expect(out).toBe("✨ AI · two cats reading on a moon under…");
  });
  it("does not truncate AI prompts at 32 chars exactly", () => {
    const prompt = "x".repeat(32);
    expect(summaryFor({ kind: "ai", aiDoodleId: "id", prompt })).toBe(
      `✨ AI · ${prompt}`,
    );
  });
});
