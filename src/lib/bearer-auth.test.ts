import { describe, expect, it } from "vitest";
import { bearerTokenMatches, constantTimeEquals } from "@/lib/bearer-auth";

const req = (auth?: string) =>
  new Request("https://x.test", auth ? { headers: { authorization: auth } } : undefined);

describe("constantTimeEquals", () => {
  it("matches equal strings and rejects different / length-mismatched", () => {
    expect(constantTimeEquals("secret", "secret")).toBe(true);
    expect(constantTimeEquals("secret", "secreT")).toBe(false);
    expect(constantTimeEquals("secret", "secret-longer")).toBe(false);
    expect(constantTimeEquals("", "")).toBe(true);
  });
});

describe("bearerTokenMatches", () => {
  it("accepts the exact Bearer token", () => {
    expect(bearerTokenMatches(req("Bearer abc123"), "abc123")).toBe(true);
  });
  it("rejects wrong token, missing header, and missing prefix", () => {
    expect(bearerTokenMatches(req("Bearer nope"), "abc123")).toBe(false);
    expect(bearerTokenMatches(req(), "abc123")).toBe(false);
    expect(bearerTokenMatches(req("abc123"), "abc123")).toBe(false);
    expect(bearerTokenMatches(req("Basic abc123"), "abc123")).toBe(false);
  });
});
