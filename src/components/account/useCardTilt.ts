"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";

const MAX_TILT_DEG = 8;

/**
 * Subtle 3D tilt that follows the pointer within the card.
 * No-op when the user prefers reduced motion or has no fine pointer
 * (touch devices) — handlers stay attached but do nothing.
 */
export function useCardTilt<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [transform, setTransform] = useState<string | null>(null);

  useEffect(() => {
    // matchMedia only exists in the browser — guard for SSR.
    if (typeof window === "undefined" || !window.matchMedia) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(pointer: fine)");
    const update = () => setEnabled(!reduced.matches && finePointer.matches);
    update();
    reduced.addEventListener("change", update);
    finePointer.addEventListener("change", update);
    return () => {
      reduced.removeEventListener("change", update);
      finePointer.removeEventListener("change", update);
    };
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent<T>) => {
      if (!enabled || !ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // -1..1 from card centre
      const dx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const dy = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      const rotateY = (dx * MAX_TILT_DEG).toFixed(2);
      const rotateX = (-dy * MAX_TILT_DEG).toFixed(2);
      setTransform(
        `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
      );
    },
    [enabled],
  );

  const onPointerLeave = useCallback(() => {
    setTransform(null);
  }, []);

  const style: CSSProperties = enabled
    ? {
        transform: transform ?? "perspective(900px) rotateX(0deg) rotateY(0deg)",
        transition: "transform 120ms ease-out",
        willChange: "transform",
      }
    : {};

  return {
    ref,
    handlers: enabled ? { onPointerMove, onPointerLeave } : {},
    style,
  };
}
