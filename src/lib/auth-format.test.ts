import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  isPhoneValid,
  prettyPhone,
  splitFullName,
  normalizeEmail,
} from "./auth-format";

describe("normalizePhone", () => {
  it("swaps a leading 0 for +61", () => {
    expect(normalizePhone("0404 978 238")).toBe("+61404978238");
  });
  it("keeps an existing + prefix", () => {
    expect(normalizePhone("+61404978238")).toBe("+61404978238");
  });
  it("prefixes a bare national number", () => {
    expect(normalizePhone("404978238")).toBe("+61404978238");
  });
  it("rejects too-short input", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("isPhoneValid", () => {
  it("requires at least 9 digits", () => {
    expect(isPhoneValid("0404 978 238")).toBe(true);
    expect(isPhoneValid("404978238")).toBe(true);
    expect(isPhoneValid("0404 12")).toBe(false);
  });
});

describe("prettyPhone", () => {
  it("formats E.164 as +61 ### ### ###", () => {
    expect(prettyPhone("+61404123456")).toBe("+61 404 123 456");
  });
  it("formats a local 0-number", () => {
    expect(prettyPhone("0404123456")).toBe("+61 404 123 456");
  });
  it("formats a bare national number", () => {
    expect(prettyPhone("404123456")).toBe("+61 404 123 456");
  });
});

describe("splitFullName", () => {
  it("splits first and last", () => {
    expect(splitFullName("Mandy Zhang")).toEqual({
      firstName: "Mandy",
      lastName: "Zhang",
    });
  });
  it("handles a single name", () => {
    expect(splitFullName("Mandy")).toEqual({ firstName: "Mandy" });
  });
  it("joins multi-word last names", () => {
    expect(splitFullName("Jamie Lee Curtis")).toEqual({
      firstName: "Jamie",
      lastName: "Lee Curtis",
    });
  });
  it("handles extra whitespace", () => {
    expect(splitFullName("  Mandy   Zhang  ")).toEqual({
      firstName: "Mandy",
      lastName: "Zhang",
    });
  });
});

describe("normalizeEmail", () => {
  it("trims + lowercases valid email", () => {
    expect(normalizeEmail("  Mandy@Email.COM ")).toBe("mandy@email.com");
  });
  it("returns null for empty", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
  });
  it("returns null for malformed", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("a b@c.com")).toBeNull();
  });
});
