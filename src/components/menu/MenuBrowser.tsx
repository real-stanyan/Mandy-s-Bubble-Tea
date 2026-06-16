"use client";

import { useMemo, useState } from "react";
import { Search, X, Gift } from "lucide-react";
import { MenuHeader } from "@/components/menu/MenuHeader";
import { ProductCard } from "@/components/menu/ProductCard";
import { CategorySidebar } from "@/components/menu/CategorySidebar";
import { CategoryRail } from "@/components/menu/CategoryRail";
import { useCategoryScrollSpy } from "@/components/menu/useCategoryScrollSpy";
import { categoryBlurb } from "@/lib/category-copy";
import type { ProductRowData } from "@/components/menu/ProductRow";

export type MenuBrowserSection = {
  slug: string;
  squareName: string;
  items: ProductRowData[];
};

function SearchField({
  query,
  setQuery,
}: {
  query: string;
  setQuery: (v: string) => void;
}) {
  return (
    <div className="relative flex items-center">
      <Search size={17} className="pointer-events-none absolute left-4 text-ink3" />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search drinks"
        autoCorrect="off"
        autoCapitalize="none"
        className="w-full rounded-full border border-line bg-paper pl-11 pr-10 text-ink outline-none transition focus:border-brand placeholder:text-ink3"
        style={{ height: 46, fontSize: 14 }}
      />
      {query.length > 0 && (
        <button
          type="button"
          onClick={() => setQuery("")}
          aria-label="Clear search"
          className="absolute right-3 grid h-6 w-6 place-items-center rounded-full text-ink3 transition active:bg-cream"
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}

function BlindBoxCard() {
  return (
    <div className="mt-3 rounded-card bg-cream p-4">
      <div className="flex items-center gap-2">
        <Gift size={17} className="text-brand" />
        <span className="text-[12.5px] font-bold text-ink">
          Buy 2, get a blind box
        </span>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink3">
        Any two drinks unlock a fragrance-tag blind box, free.
      </p>
    </div>
  );
}

export function MenuBrowser({ sections }: { sections: MenuBrowserSection[] }) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim().toLowerCase();
  const searching = trimmed.length > 0;

  const searchResults = useMemo(() => {
    if (!searching) return [] as ProductRowData[];
    const hits: ProductRowData[] = [];
    const seen = new Set<string>();
    for (const section of sections) {
      for (const item of section.items) {
        const dedupKey = `${item.id}:${item.categorySlug}`;
        if (seen.has(dedupKey)) continue;
        if (item.name.toLowerCase().includes(trimmed)) {
          seen.add(dedupKey);
          hits.push(item);
        }
      }
    }
    return hits;
  }, [sections, trimmed, searching]);

  const sidebarItems = useMemo(
    () =>
      sections.map((s) => ({
        slug: s.slug,
        label: s.squareName,
        count: s.items.length,
      })),
    [sections],
  );

  const { active, scrollToCategory } = useCategoryScrollSpy(sidebarItems);

  return (
    <>
      <MenuHeader />

      {/* Mobile search (sidebar is a horizontal rail on small screens) */}
      <div className="mx-4 mt-2 mb-4 lg:hidden">
        <SearchField query={query} setQuery={setQuery} />
      </div>

      <div className="lg:grid lg:grid-cols-[234px_1fr] lg:gap-11 lg:px-4">
        <aside>
          {/* Mobile / tablet rail */}
          <div className="sticky top-2 max-h-[calc(100vh-1rem)] overflow-y-auto pb-6 lg:hidden">
            <CategoryRail
              items={sidebarItems}
              active={active}
              onSelect={scrollToCategory}
            />
          </div>
          {/* Desktop sidebar: search + categories + promo */}
          <div className="sticky top-24 hidden max-h-[calc(100vh-7rem)] flex-col overflow-y-auto pb-6 lg:flex">
            <div className="mb-2">
              <SearchField query={query} setQuery={setQuery} />
            </div>
            <CategorySidebar
              items={sidebarItems}
              active={active}
              onSelect={scrollToCategory}
            />
            <BlindBoxCard />
          </div>
        </aside>

        <div className="pb-16">
          {searching ? (
            searchResults.length === 0 ? (
              <p className="mt-12 text-center text-ink3" style={{ fontSize: 15 }}>
                No drinks match &quot;{query.trim()}&quot;
              </p>
            ) : (
              <>
                <p className="mx-4 mb-4 font-semibold text-ink3 lg:mx-0" style={{ fontSize: 13 }}>
                  {searchResults.length} result
                  {searchResults.length !== 1 ? "s" : ""} for &quot;
                  {query.trim()}&quot;
                </p>
                <div className="mx-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:mx-0">
                  {searchResults.map((item) => (
                    <ProductCard
                      key={`${item.id}:${item.categorySlug}`}
                      item={item}
                    />
                  ))}
                </div>
              </>
            )
          ) : (
            sections.map((section) => (
              <section
                key={section.slug}
                id={`cat-${section.slug}`}
                className="mb-12 scroll-mt-24"
              >
                <div className="mx-4 mb-4 lg:mx-0">
                  <h2
                    className="font-serif text-ink"
                    style={{ fontSize: 28, letterSpacing: -0.6, fontWeight: 600 }}
                  >
                    {section.squareName}
                  </h2>
                  <p className="mt-1 text-[14px] text-ink3">
                    {categoryBlurb(section.squareName, section.items.length)}
                  </p>
                </div>
                <div className="mx-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:mx-0">
                  {section.items.map((item) => (
                    <ProductCard key={item.id} item={item} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </>
  );
}
