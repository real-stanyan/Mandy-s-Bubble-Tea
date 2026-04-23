"use client";

import { useEffect, useState } from "react";

export type CategorySidebarItem = {
  slug: string;
  label: string;
};

export function CategorySidebar({
  items,
}: {
  items: CategorySidebarItem[];
}) {
  const [active, setActive] = useState(items[0]?.slug ?? "");

  useEffect(() => {
    if (items.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) {
          const id = visible[0].target.id;
          const slug = id.replace(/^cat-/, "");
          setActive(slug);
        }
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: [0, 0.2, 0.5] },
    );
    for (const it of items) {
      const el = document.getElementById(`cat-${it.slug}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>, slug: string) {
    e.preventDefault();
    const el = document.getElementById(`cat-${slug}`);
    if (!el) return;
    setActive(slug);
    const top = el.getBoundingClientRect().top + window.scrollY - 88;
    window.scrollTo({ top, behavior: "smooth" });
  }

  return (
    <nav aria-label="Menu categories" className="flex flex-col gap-1">
      <p
        className="font-mono uppercase text-ink3 mb-1 px-3"
        style={{ fontSize: 10.5, letterSpacing: 1.3, fontWeight: 700 }}
      >
        Categories
      </p>
      {items.map((it) => {
        const isActive = it.slug === active;
        return (
          <a
            key={it.slug}
            href={`#cat-${it.slug}`}
            onClick={(e) => handleClick(e, it.slug)}
            className={
              "group flex items-center gap-2 rounded-full px-3 py-2 font-serif transition " +
              (isActive
                ? "bg-brand text-white"
                : "text-ink2 hover:bg-cream")
            }
            style={{ fontSize: 15, letterSpacing: -0.2, fontWeight: 500 }}
          >
            <span
              className={
                "inline-block h-1.5 w-1.5 rounded-full transition " +
                (isActive ? "bg-white" : "bg-ink4 group-hover:bg-brand")
              }
            />
            {it.label}
          </a>
        );
      })}
    </nav>
  );
}
