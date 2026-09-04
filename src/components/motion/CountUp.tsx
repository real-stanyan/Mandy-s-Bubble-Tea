"use client";

import { useEffect, useRef, useState } from "react";

// "30+" counts up from 0 the first time it scrolls into view. The number is
// parsed out of the label so prefixes/suffixes ("100%", "2016") survive; a
// label with no digits is rendered as-is. Server render shows the final
// value, so nothing depends on JS for correctness.

function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export function CountUp({
  value,
  durationMs = 1100,
  className,
}: {
  value: string;
  durationMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const match = value.match(/(\D*)(\d[\d,]*)(.*)/);
    if (!match) return;
    const reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduced || typeof IntersectionObserver === "undefined") return;

    const [, prefix, digits, suffix] = match;
    const target = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(target)) return;
    let raf = 0;
    let settle = 0;
    const format = (n: number) => `${prefix}${n.toLocaleString("en-AU")}${suffix}`;

    const run = () => {
      let start: number | null = null;
      const tick = (now: number) => {
        // The first frame's timestamp is the clock we count from — a
        // performance.now() taken before requestAnimationFrame can sit
        // AHEAD of the frame time and produce a negative step ("-1+").
        if (start === null) start = now;
        const t = Math.min(1, Math.max(0, (now - start) / durationMs));
        setShown(format(Math.round(target * easeOutExpo(t))));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      // Frames stop in a background tab; make sure the final value lands
      // regardless, so nobody returns to a counter frozen mid-run.
      settle = window.setTimeout(() => {
        cancelAnimationFrame(raf);
        setShown(value);
      }, durationMs + 120);
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          run();
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [value, durationMs]);

  return (
    <span ref={ref} className={className}>
      {shown}
    </span>
  );
}
