"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { MenuHeader } from "@/components/menu/MenuHeader";
import { SectionHeader } from "@/components/menu/SectionHeader";
import { ProductRow, type ProductRowData } from "@/components/menu/ProductRow";

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

  return (
    <>
      <MenuHeader />
      <div className="mx-3 mt-2 mb-1.5 flex items-center gap-2.5 rounded-full border border-line bg-paper px-3.5"
        style={{ height: 42 }}
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
        searchResults.length === 0 ? (
          <p className="mt-10 text-center text-ink3" style={{ fontSize: 13 }}>
            No drinks match &quot;{query.trim()}&quot;
          </p>
        ) : (
          <div className="pt-2">
            {searchResults.map((item) => (
              <ProductRow key={item.id} item={item} />
            ))}
          </div>
        )
      ) : (
        <div className="pb-12">
          {sections.map((section) => (
            <section key={section.slug}>
              <SectionHeader title={section.squareName} />
              {section.items.map((item) => (
                <ProductRow key={item.id} item={item} />
              ))}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
