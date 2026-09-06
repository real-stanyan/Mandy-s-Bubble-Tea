"use client";

import { useState } from "react";
import Image from "next/image";
import type { ProductRowData } from "@/components/menu/ProductRow";

type Props = {
  title: string;
  items: ProductRowData[];
};

// Per-category hero banner: a uniform-width strip of product images
// flowing L→R (auto-scrolling, items duplicated for seamless loop).
// No background, no overlay, no container color — the page bg shows
// through and products tile seamlessly with no border between them.
// The large category name sits on top of the strip with a blue glow
// + 1px dark stroke so white text stays readable on any product photo.
export function CategoryHero({ title, items }: Props) {
  const withImage = items.filter((i) => i.imageUrl);
  const [paused, setPaused] = useState(false);

  // Single fixed width → every product same size in the strip.
  // Duplicated for seamless marquee loop.
  const strip = withImage.length >= 2 ? [...withImage, ...withImage] : withImage;
  const isMarquee = withImage.length >= 2;
  const PRODUCT_W = 180; // px, uniform for every slot

  return (
    <div
      className="relative my-3 overflow-hidden lg:my-4"
      style={{ height: "var(--hero-h, 200px)" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {withImage.length === 0 ? (
        // No images for this category — leave transparent; nothing to
        // show. The h2 still floats over the page bg.
        null
      ) : isMarquee ? (
        <div
          className={`absolute inset-0 flex w-max items-stretch ${paused ? "" : "animate-marquee-ltr"}`}
        >
          {strip.map((item, i) => (
            <div
              key={`${item.id}-${i}`}
              className="relative shrink-0"
              style={{ width: PRODUCT_W, height: "100%" }}
            >
              {item.imageUrl ? (
                <Image
                  src={item.imageUrl}
                  alt={item.name}
                  fill
                  sizes="180px"
                  className="object-cover"
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        // 0–1 product image → static centered, no animation.
        // Center it with translateX so the single image sits in the
        // middle of the hero width.
        <div
          className="absolute inset-0 flex items-center"
        >
          <div
            className="relative shrink-0"
            style={{ width: PRODUCT_W, height: "100%" }}
          >
            {withImage[0]?.imageUrl ? (
              <Image
                src={withImage[0].imageUrl}
                alt={withImage[0].name}
                fill
                sizes="180px"
                className="object-cover"
              />
            ) : null}
          </div>
        </div>
      )}

      {/* Foreground: large category name with glow + dark stroke for
          readability on any product image. */}
      <div className="relative flex h-full items-center justify-center px-4">
        <h2
          className="font-serif font-bold uppercase text-white text-glow-pulse text-center"
          style={{
            fontSize: "clamp(2rem, 6vw, 4.5rem)",
            letterSpacing: "0.08em",
            paintOrder: "stroke fill",
            WebkitTextStroke: "1px rgba(0, 0, 0, 0.55)",
          }}
        >
          {title}
        </h2>
      </div>
    </div>
  );
}
