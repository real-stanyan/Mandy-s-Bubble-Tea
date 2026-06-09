"use client";

import { useEffect, useState } from "react";

/**
 * Scroll-spy for the menu page. Observes `#cat-<slug>` section anchors and
 * tracks which category is active; `scrollToCategory` smooth-scrolls the window
 * to a section (88px header offset). Shared by CategorySidebar (desktop) and
 * CategoryRail (mobile). Behavior lifted verbatim from the old CategorySidebar.
 */
export function useCategoryScrollSpy(items: { slug: string }[]) {
  const [active, setActive] = useState(items[0]?.slug ?? "");

  useEffect(() => {
    if (items.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) {
          setActive(visible[0].target.id.replace(/^cat-/, ""));
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

  function scrollToCategory(slug: string) {
    const el = document.getElementById(`cat-${slug}`);
    if (!el) return;
    setActive(slug);
    const top = el.getBoundingClientRect().top + window.scrollY - 88;
    window.scrollTo({ top, behavior: "smooth" });
  }

  return { active, scrollToCategory };
}
