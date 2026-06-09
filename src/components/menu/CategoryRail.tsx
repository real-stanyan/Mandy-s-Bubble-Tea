"use client";

import type { CategorySidebarItem } from "@/components/menu/CategorySidebar";

/**
 * Mobile/tablet category rail (< lg). App-style narrow vertical column: each
 * category is a centered, 2-line-clamped tap target; active gets a brand-color
 * left bar + brand text. Controlled — driven by useCategoryScrollSpy via props.
 */
export function CategoryRail({
  items,
  active,
  onSelect,
}: {
  items: CategorySidebarItem[];
  active: string;
  onSelect: (slug: string) => void;
}) {
  return (
    <nav aria-label="Menu categories" className="flex flex-col">
      {items.map((it) => {
        const isActive = it.slug === active;
        return (
          <button
            key={it.slug}
            type="button"
            onClick={() => onSelect(it.slug)}
            aria-current={isActive ? "true" : undefined}
            className={
              "relative flex items-center justify-center px-1.5 text-center transition " +
              (isActive ? "bg-paper" : "active:bg-cream")
            }
            style={{ minHeight: 64 }}
          >
            {isActive && (
              <span
                className="absolute left-0 rounded-r bg-brand"
                style={{ top: 12, bottom: 12, width: 4 }}
              />
            )}
            <span
              className={
                "font-serif line-clamp-2 " +
                (isActive ? "text-brand" : "text-ink2")
              }
              style={{
                fontSize: 12.5,
                lineHeight: "15px",
                letterSpacing: -0.1,
                fontWeight: isActive ? 600 : 500,
              }}
            >
              {it.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
