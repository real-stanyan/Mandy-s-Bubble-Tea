"use client";

export type CategorySidebarItem = {
  slug: string;
  label: string;
  count?: number;
};

export function CategorySidebar({
  items,
  active,
  onSelect,
}: {
  items: CategorySidebarItem[];
  active: string;
  onSelect: (slug: string) => void;
}) {
  return (
    <nav aria-label="Menu categories" className="flex flex-col gap-1.5">
      {items.map((it) => {
        const isActive = it.slug === active;
        return (
          <a
            key={it.slug}
            href={`#cat-${it.slug}`}
            aria-current={isActive ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              onSelect(it.slug);
            }}
            className={
              "cat-link flex items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-left " +
              (isActive
                ? "bg-cream text-brand"
                : "text-ink2 hover:bg-[rgba(42,30,20,0.04)]")
            }
            style={{ fontSize: 14.5, letterSpacing: -0.2, fontWeight: 600 }}
          >
            {it.label}
            {it.count != null && (
              <span
                className="text-ink4"
                style={{ fontSize: 11.5, fontWeight: 700 }}
              >
                {it.count}
              </span>
            )}
          </a>
        );
      })}
    </nav>
  );
}
