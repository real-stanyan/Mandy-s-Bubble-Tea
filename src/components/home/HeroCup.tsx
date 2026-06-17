"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

// Floating hero cup that rotates through the transparent-cup pool every few
// seconds. All cups are stacked and cross-faded via opacity so the swap is
// smooth and every image is preloaded. The starting cup is chosen on the
// server and passed in, so the first client render matches the SSR markup
// (no hydration mismatch); the interval takes over after mount.

export function HeroCup({
  cups,
  startIndex = 0,
  intervalMs = 5000,
}: {
  cups: string[];
  startIndex?: number;
  intervalMs?: number;
}) {
  const [active, setActive] = useState(startIndex);

  useEffect(() => {
    if (cups.length <= 1) return;
    const id = setInterval(() => {
      setActive((i) => (i + 1) % cups.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [cups.length, intervalMs]);

  return (
    <div className="relative aspect-square w-full">
      {cups.map((src, i) => (
        <Image
          key={src}
          src={src}
          alt="Mandy's Bubble Tea"
          width={520}
          height={520}
          priority={i === startIndex}
          aria-hidden={i !== active}
          className="absolute inset-0 h-full w-full object-contain transition-opacity duration-700 ease-in-out motion-reduce:transition-none"
          style={{
            opacity: i === active ? 1 : 0,
            filter: "drop-shadow(0 30px 44px rgba(42,30,20,0.34))",
          }}
        />
      ))}
    </div>
  );
}
