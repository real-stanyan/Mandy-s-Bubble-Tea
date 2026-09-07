// A liquid surface for SVG: a sine-ish ribbon drawn with quadratic curves,
// one full `wavelength` wider than it needs to be on the left so the group it
// sits in can scroll left by exactly one wavelength and loop with no seam.
// Pure string maths — the SVG side only ever animates the group's transform.
//
// Mirror of the App's lib/motion/wave.ts. Keep the two in lockstep.

export type WaveSpec = {
  /** Left edge of the area the wave must cover. */
  x0: number;
  /** Width of the area it must cover; the path is built one wavelength wider on both sides. */
  width: number;
  /** y of the resting surface line. */
  top: number;
  amplitude: number;
  wavelength: number;
  /** How far below the surface the ribbon extends (fill colour continues to here). */
  depth: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** SVG path for the ribbon: `M … Q … T … V … H … Z`. */
export function wavePath({
  x0,
  width,
  top,
  amplitude,
  wavelength,
  depth,
}: WaveSpec): string {
  const wl = Math.max(1, wavelength);
  const start = x0 - wl;
  const end = x0 + width + wl;
  const half = wl / 2;
  const parts: string[] = [`M${r2(start)} ${r2(top)}`];
  let x = start;
  let up = true;
  while (x < end) {
    const cx = x + half / 2;
    const cy = up ? top - amplitude : top + amplitude;
    x += half;
    parts.push(`Q${r2(cx)} ${r2(cy)} ${r2(x)} ${r2(top)}`);
    up = !up;
  }
  parts.push(`V${r2(top + depth)}`, `H${r2(start)}`, "Z");
  return parts.join(" ");
}

/** Number of curve segments the ribbon uses — two per wavelength. */
export function waveSegmentCount(spec: WaveSpec): number {
  const wl = Math.max(1, spec.wavelength);
  const span = spec.width + 2 * wl;
  return Math.ceil(span / (wl / 2));
}
