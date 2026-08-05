import { describe, it, expect } from "vitest";
import {
  displayValue,
  normalise,
  pressBackspace,
  pressDigit,
  pressDot,
} from "./keypad-value";

// Typing is where a counting tool quietly corrupts data: an extra tap that
// truncates, a leading zero that turns 5 into 0.5, a blank that becomes a
// counted zero. These pin the taps, not the rendering.

describe("digits", () => {
  it("builds a number one tap at a time", () => {
    let v = "";
    v = pressDigit(v, "2");
    v = pressDigit(v, "4");
    expect(v).toBe("24");
  });

  it("replaces a lone leading zero rather than prefixing it", () => {
    // Otherwise the first tap after opening a blank-but-zeroed sheet reads as
    // "05" and normalises to 5 only by luck.
    expect(pressDigit("0", "5")).toBe("5");
  });

  it("keeps a zero that is part of a longer number", () => {
    expect(pressDigit("1", "0")).toBe("10");
    expect(pressDigit("0.", "5")).toBe("0.5");
  });

  it("ignores a third whole digit instead of dropping what's there", () => {
    // A stray tap should do nothing, not silently rewrite the count.
    expect(pressDigit("99", "9")).toBe("99");
  });

  it("allows only one decimal place", () => {
    expect(pressDigit("0.5", "5")).toBe("0.5");
  });

  it("ignores anything that isn't a digit", () => {
    expect(pressDigit("3", "x")).toBe("3");
  });
});

describe("decimal point", () => {
  it("starts a fraction, filling in the leading zero", () => {
    expect(pressDot("")).toBe("0.");
    expect(pressDot("3")).toBe("3.");
  });

  it("refuses a second point", () => {
    expect(pressDot("0.5")).toBe("0.5");
  });
});

describe("backspace", () => {
  it("removes the last tap, including the point", () => {
    expect(pressBackspace("0.5")).toBe("0.");
    expect(pressBackspace("0.")).toBe("0");
    expect(pressBackspace("0")).toBe("");
  });

  it("is a no-op on an empty value", () => {
    expect(pressBackspace("")).toBe("");
  });
});

describe("normalise", () => {
  it("keeps blank blank", () => {
    // The distinction the whole report rests on: uncounted is not zero.
    expect(normalise("")).toBe("");
    expect(normalise(".")).toBe("");
  });

  it("keeps whole numbers whole", () => {
    expect(normalise("3")).toBe("3");
    expect(normalise("3.0")).toBe("3");
  });

  it("finishes an unfinished tap", () => {
    expect(normalise("3.")).toBe("3");
  });

  it("keeps the fractions the shop actually counts", () => {
    expect(normalise("0.3")).toBe("0.3");
    expect(normalise("0.5")).toBe("0.5");
  });

  it("keeps a counted zero, which is not the same as blank", () => {
    expect(normalise("0")).toBe("0");
  });

  it("clamps rather than rejecting", () => {
    expect(normalise("99.9")).toBe("99.9");
  });
});

describe("displayValue", () => {
  it("shows a dash for nothing entered, never a zero", () => {
    expect(displayValue("")).toBe("—");
    expect(displayValue("0")).toBe("0");
  });
});
