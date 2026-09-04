"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

// Scroll reveal. The element renders with data-reveal="" (hidden by CSS in
// globals.css) and flips to "in" the first time it enters the viewport, so
// sections rise into place as the customer reads down the page instead of
// all landing at once. Stagger siblings with `delay`. Reduced-motion users
// and environments without IntersectionObserver see everything immediately.

type Props = {
  children: ReactNode;
  /** ms, added to the CSS transition delay — stagger siblings with i * 70. */
  delay?: number;
  /** Add a subtle scale-in on top of the rise (cards, imagery). */
  scale?: boolean;
  className?: string;
  as?: "div" | "section" | "li" | "article";
  style?: CSSProperties;
};

export function Reveal({
  children,
  delay = 0,
  scale = false,
  className,
  as = "div",
  style,
}: Props) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      el.dataset.reveal = "in";
      return;
    }
    // Anything already on screen at mount reveals straight away rather
    // than waiting on the observer's first delivery — which a background
    // tab defers until it is fronted, leaving the fold blank meanwhile.
    const inView = () => {
      const rect = el.getBoundingClientRect();
      return rect.top < window.innerHeight * 1.05 && rect.bottom > 0;
    };
    if (inView()) {
      el.dataset.reveal = "in";
      return;
    }
    let done = false;
    const show = () => {
      if (done) return;
      done = true;
      el.dataset.reveal = "in";
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) show();
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    // Belt and braces: a plain scroll check alongside the observer, for
    // documents the browser considers hidden (embedded webviews, a tab
    // fronted after load) where observer callbacks can lag well behind
    // the scroll position.
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (inView()) show();
      });
    };
    io.observe(el);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const Tag = as;
  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      data-reveal=""
      data-reveal-scale={scale ? "" : undefined}
      className={className}
      style={{ ...style, "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}
