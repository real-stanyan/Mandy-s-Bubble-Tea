import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";

const ORIGIN = "https://mandybubbletea.com";

describe("safeNextPath", () => {
  it("allows same-origin relative paths", () => {
    expect(safeNextPath("/account", ORIGIN)).toBe("/account");
    expect(safeNextPath("/menu?x=1#top", ORIGIN)).toBe("/menu?x=1#top");
  });

  it("falls back for empty / non-relative input", () => {
    expect(safeNextPath(null, ORIGIN)).toBe("/account");
    expect(safeNextPath("", ORIGIN)).toBe("/account");
    expect(safeNextPath("account", ORIGIN)).toBe("/account");
  });

  it("blocks protocol-relative and absolute-URL redirects", () => {
    expect(safeNextPath("//evil.com", ORIGIN)).toBe("/account");
    expect(safeNextPath("https://evil.com", ORIGIN)).toBe("/account");
    expect(safeNextPath("http://evil.com/path", ORIGIN)).toBe("/account");
  });

  it("blocks the backslash / control-char bypass (the real vuln)", () => {
    // These pass the naive `startsWith("/") && !startsWith("//")` check but
    // new URL() would resolve them to https://evil.com/.
    expect(safeNextPath("/\\evil.com", ORIGIN)).toBe("/account");
    expect(safeNextPath("/\t/evil.com", ORIGIN)).toBe("/account");
    expect(safeNextPath("/\\/evil.com", ORIGIN)).toBe("/account");
  });
});
