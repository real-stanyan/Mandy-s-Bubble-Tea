// Text colour for a name sitting on a staff member's colour swatch.
//
// The palette spans a yellow that needs dark text and a blue that needs light
// text, so a single hardcoded colour is wrong for half of it. Picking per
// swatch keeps every name legible however the palette changes later.

export const INK = "#18181b";
export const PAPER = "#ffffff";

/** WCAG relative luminance of an #rgb / #rrggbb colour. */
export function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const channel = (i: number) => {
    const v = parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Whichever of ink/white contrasts better against `background`. */
export function readableInk(background: string): string {
  const bg = relativeLuminance(background);
  return contrast(bg, relativeLuminance(INK)) >= contrast(bg, relativeLuminance(PAPER))
    ? INK
    : PAPER;
}
