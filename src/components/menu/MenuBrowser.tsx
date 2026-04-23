"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { MenuHeader } from "@/components/menu/MenuHeader";
import { SectionHeader } from "@/components/menu/SectionHeader";
import { ProductCard } from "@/components/menu/ProductCard";
import { CategorySidebar } from "@/components/menu/CategorySidebar";
import type { ProductRowData } from "@/components/menu/ProductRow";

export type MenuBrowserSection = {
  slug: string;
  squareName: string;
  items: ProductRowData[];
};

export function MenuBrowser({ sections }: { sections: MenuBrowserSection[] }) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim().toLowerCase();
  const searching = trimmed.length > 0;

  const searchResults = useMemo(() => {
    if (!searching) return [] as ProductRowData[];
    const hits: ProductRowData[] = [];
    for (const section of sections) {
      for (const item of section.items) {
        if (item.name.toLowerCase().includes(trimmed)) {
          hits.push(item);
        }
      }
    }
    return hits;
  }, [sections, trimmed, searching]);

  const sidebarItems = useMemo(
    () => sections.map((s) => ({ slug: s.slug, label: s.squareName })),
    [sections],
  );

  return (
    <>
      <MenuHeader />

      <div
        className="mx-4 mt-2 mb-5 flex items-center gap-2.5 rounded-full border border-line bg-paper px-3.5 md:max-w-xl"
        style={{ height: 44 }}
      >
        <Search size={18} className="text-ink3" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search drinks"
          autoCorrect="off"
          autoCapitalize="none"
          className="flex-1 bg-transparent text-ink outline-none placeholder:text-ink3"
          style={{ fontSize: 14 }}
        />
        {query.length > 0 && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="flex h-6 w-6 items-center justify-center rounded-full text-ink3 transition active:bg-cream"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {searching ? (
        <div className="mx-4">
          {searchResults.length === 0 ? (
            <p className="mt-10 text-center text-ink3" style={{ fontSize: 13 }}>
              No drinks match &quot;{query.trim()}&quot;
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {searchResults.map((item) => (
                <ProductCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-6 lg:px-4">
          <aside className="hidden lg:block">
            <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pb-6">
              <CategorySidebar items={sidebarItems} />
            </div>
          </aside>
          <div className="pb-16">
            {sections.map((section) => (
              <section
                key={section.slug}
                id={`cat-${section.slug}`}
                className="scroll-mt-24"
              >
                <SectionHeader title={section.squareName} />
                <div className="mx-4 mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:mx-0 lg:grid-cols-3 xl:grid-cols-4">
                  {section.items.map((item) => (
                    <ProductCard key={item.id} item={item} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
