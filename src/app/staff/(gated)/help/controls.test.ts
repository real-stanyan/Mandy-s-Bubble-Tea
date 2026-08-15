import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The counter controls, checked as numbers rather than as a look.
//
// This page is used one-handed, mid-service, at arm's length, on a phone
// wedged next to the till. Both properties below were wrong on the first
// version and neither was visible by reading the markup: the language buttons
// were 20px-tall text links, and the filled blue failed AA against white.

const SRC = readFileSync(
  join(process.cwd(), "src/app/staff/(gated)/help/help-chat.tsx"),
  "utf8",
);
// The microphone moved into a shared component once the stock page grew one
// too — two hand-copied versions of the control both pages exist for would
// have drifted. The assertions follow it rather than staying put.
const MIC = readFileSync(
  join(process.cwd(), "src/app/staff/(gated)/mic-button.tsx"),
  "utf8",
);

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("staff help controls", () => {
  it("gives every filled blue enough contrast for white text", () => {
    // 4.06:1 was the original, which fails AA for 16px text. Anything filled
    // in this component carries white text, so one number covers the send
    // button, the live mic, the chosen language and the staff member's own
    // messages.
    const fills = [...SRC.matchAll(/bg-\[(#[0-9A-Fa-f]{6})\]/g)].map((m) => m[1]);
    expect(fills.length).toBeGreaterThan(0);
    for (const hex of new Set(fills)) {
      expect(contrast(hex, "#FFFFFF"), `white on ${hex}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps a filled control visible against the dark page it sits on", () => {
    // The other half of the squeeze: darkening for the white text eventually
    // sinks the button into the dark background. 3:1 is the floor for a UI
    // component's own shape.
    const fills = [...SRC.matchAll(/bg-\[(#[0-9A-Fa-f]{6})\]/g)].map((m) => m[1]);
    for (const hex of new Set(fills)) {
      expect(contrast(hex, "#18181B"), `${hex} on the dark page`).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps the microphone the biggest thing on the page", () => {
    // Talking is the primary way in — someone holding a cup should be able to
    // hit it without looking. It started as a 44px square with a 🎤 emoji
    // wedged beside the text field.
    const start = MIC.indexOf('aria-label={listening ? "Stop listening"');
    expect(start, "mic button not found").toBeGreaterThan(-1);
    const block = MIC.slice(start, MIC.indexOf("</button>", start));
    expect(block).toMatch(/h-20 w-20/);
    expect(block).toMatch(/rounded-full/);
  });

  it("draws the microphone rather than borrowing an emoji", () => {
    // 🎤 is a different picture on every platform and renders at whatever size
    // the font decides, which is the opposite of a control you aim at.
    const start = MIC.indexOf('aria-label={listening ? "Stop listening"');
    const block = MIC.slice(start, MIC.indexOf("</button>", start));
    expect(block).toMatch(/<svg/);
    // Comments stripped: the emoji is named in the comment that explains why
    // it is not used, and this assertion is about what renders.
    const rendered = block.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(rendered).not.toMatch(/🎤/);
  });

  it("makes every language button a real tap target", () => {
    // 44px is the size a thumb needs. Picking the wrong language is what
    // turned "现在店里正常吗" into "Send down the jump", so this is the
    // control that must not be fiddly.
    const start = SRC.indexOf("LANGUAGE_LABEL) as StaffLanguage[]");
    expect(start, "language buttons not found").toBeGreaterThan(-1);
    // Bounded at the button's own closing tag. A wider window reaches the
    // "Read answers aloud" row below, whose min-h-11 would satisfy this
    // assertion while the language buttons stayed 20px tall — which is
    // exactly what happened when this was first written.
    const end = SRC.indexOf("</button>", start);
    expect(end, "no button after the language map").toBeGreaterThan(start);
    expect(SRC.slice(start, end)).toMatch(/min-h-11/);
  });
});
