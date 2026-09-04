"use client";

// Web port of the RN `components/doodle/DoodleCanvas.tsx`. Identical
// 400×400 vector geometry + `SvgPath[]` output shape, so the same
// payload feeds /api/doodle/upload + enqueueCupLabelJobs.
//
// Browser quirks vs. RN PanResponder:
//  - Pointer Events unify mouse / touch / pen — no separate handlers.
//  - touchAction: 'none' suppresses scroll/zoom inside the canvas so a
//    finger drag draws instead of panning the page.
//  - setPointerCapture pins the move/up events to the SVG even if the
//    pointer crosses the element boundary (matches PanResponder
//    onPanResponderTerminationRequest: false).

import { useRef, useState } from "react";
import type { SvgPath } from "@/lib/doodle/render-svg";

export const CANVAS_W = 400;
export const CANVAS_H = 400;
export const BRUSHES = [3, 6, 10] as const;
export type BrushWidth = (typeof BRUSHES)[number];

interface Props {
  paths: SvgPath[];
  brushWidth: BrushWidth;
  onPathsChange: (next: SvgPath[]) => void;
}

export function DrawCanvas({ paths, brushWidth, onPathsChange }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const currentPath = useRef<string>("");
  const [draftD, setDraftD] = useState<string>("");

  function toCanvasCoords(e: React.PointerEvent<SVGSVGElement>): {
    x: number;
    y: number;
  } {
    const rect = e.currentTarget.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    const x = ((e.clientX - rect.left) / w) * CANVAS_W;
    const y = ((e.clientY - rect.top) / h) * CANVAS_H;
    return { x, y };
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = toCanvasCoords(e);
    currentPath.current = `M${x.toFixed(1)},${y.toFixed(1)}`;
    setDraftD(currentPath.current);
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!currentPath.current) return;
    const { x, y } = toCanvasCoords(e);
    currentPath.current += ` L${x.toFixed(1)},${y.toFixed(1)}`;
    setDraftD(currentPath.current);
  }

  function commit(_e: React.PointerEvent<SVGSVGElement>) {
    if (currentPath.current && currentPath.current.includes("L")) {
      onPathsChange([
        ...paths,
        { d: currentPath.current, stroke: "#000", width: brushWidth },
      ]);
    }
    currentPath.current = "";
    setDraftD("");
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      preserveAspectRatio="xMidYMid meet"
      className="aspect-square w-full select-none rounded-tile border border-line bg-[#fff]"
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={commit}
      onPointerCancel={commit}
    >
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          stroke={p.stroke}
          strokeWidth={p.width}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {draftD ? (
        <path
          d={draftD}
          stroke="#000"
          strokeWidth={brushWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}
