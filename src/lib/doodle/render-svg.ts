import "server-only";
import { Resvg } from "@resvg/resvg-js";

export type RenderOpts = { widthPx: number; heightPx: number };

export async function renderSvgToPng(svg: string, opts: RenderOpts): Promise<Buffer> {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: opts.widthPx },
    background: "rgba(255,255,255,1)",
  });
  return Buffer.from(resvg.render().asPng());
}

export type SvgPath = { d: string; stroke: string; width: number };

export function pathsJsonToSvg(paths: SvgPath[], canvasSize: number): string {
  const safe = paths.map(validateSvgPath);
  const body = safe
    .map(
      p =>
        `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasSize} ${canvasSize}">${body}</svg>`;
}

export function validateSvgPaths(paths: SvgPath[]): void {
  for (const p of paths) validateSvgPath(p);
}

function validateSvgPath(p: SvgPath): SvgPath {
  if (!/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+\-]+$/.test(p.d)) {
    throw new Error(`Invalid svg path: d contains disallowed characters`);
  }
  if (!/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(p.stroke)) {
    throw new Error(`Invalid svg path: stroke must be #RGB or #RRGGBB`);
  }
  if (!Number.isFinite(p.width) || p.width < 0.5 || p.width > 30) {
    throw new Error(`Invalid svg path: width must be in [0.5, 30]`);
  }
  return p;
}
