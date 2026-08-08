"use client";

import { useEffect } from "react";
import { lockBodyScroll } from "@/lib/scroll-lock";

/**
 * Hold the shared page-scroll lock while `active` is true.
 *
 * Replaces the per-overlay `document.body.style.overflow` save/restore that
 * three components each carried their own copy of. See src/lib/scroll-lock.ts
 * for why counting (and the attribute, not the inline style) is the fix.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return lockBodyScroll();
  }, [active]);
}
