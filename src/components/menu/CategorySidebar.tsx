"use client";

export type CategorySidebarItem = {
  slug: string;
  label: string;
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
            aria-current={isActive ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              onSelect(it.slug);
            }}
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
