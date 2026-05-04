import { describe, expect, it, vi } from "vitest";
import { generateClaimCode, generateUniqueClaimCode } from "./claim-code";

describe("generateClaimCode", () => {
  it("returns a 6-character string", () => {
    const code = generateClaimCode();
    expect(code).toHaveLength(6);
  });

  it("excludes ambiguous characters I, L, O, U", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateClaimCode();
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it("uses Crockford base32 alphabet", () => {
    const allowed = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/;
    for (let i = 0; i < 100; i++) {
      const code = generateClaimCode();
      expect(code).toMatch(allowed);
    }
  });
});

describe("generateUniqueClaimCode", () => {
  it("returns the first generated code if no collision", async () => {
    const checkExists = vi.fn().mockResolvedValue(false);
    const code = await generateUniqueClaimCode(checkExists);
    expect(code).toHaveLength(6);
    expect(checkExists).toHaveBeenCalledTimes(1);
  });

  it("retries on collision until unique", async () => {
    const checkExists = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const code = await generateUniqueClaimCode(checkExists);
    expect(code).toHaveLength(6);
    expect(checkExists).toHaveBeenCalledTimes(3);
  });

  it("throws after 5 collisions", async () => {
    const checkExists = vi.fn().mockResolvedValue(true);
    await expect(generateUniqueClaimCode(checkExists)).rejects.toThrow(
      /failed after 5 attempts/,
    );
    expect(checkExists).toHaveBeenCalledTimes(5);
  });
});
