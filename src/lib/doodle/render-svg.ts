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
  const body = paths
    .map(
      p =>
        `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasSize} ${canvasSize}">${body}</svg>`;
}
