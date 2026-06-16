"use client";

import { useMemo, useState } from "react";
import { Search, X, Gift } from "lucide-react";
import { MenuHeader } from "@/components/menu/MenuHeader";
import { ProductCard } from "@/components/menu/ProductCard";
import { CategorySidebar } from "@/components/menu/CategorySidebar";
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

// Mobile category selector — horizontal scrolling chips (matches menu.jsx).
function ChipBar({
  items,
  active,
  onSelect,
}: {
  items: { slug: string; label: string }[];
  active: string;
  onSelect: (slug: string) => void;
}) {
  return (
    <div className="scrollbar-hide flex gap-2 overflow-x-auto px-4 pb-1.5 pt-3.5">
      {items.map((it) => {
        const on = it.slug === active;
        return (
          <button
            key={it.slug}
            type="button"
            onClick={() => onSelect(it.slug)}
            aria-pressed={on}
            className={
              "shrink-0 whitespace-nowrap rounded-full border px-[15px] py-2 text-[13px] font-semibold transition " +
              (on
                ? "border-transparent bg-brand text-white"
                : "border-line bg-card text-ink2")
            }
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function CategorySection({ section }: { section: MenuBrowserSection }) {
  return (
    <section id={`cat-${section.slug}`} className="mb-12 scroll-mt-24">
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
  );
}

function ResultsGrid({
  results,
  query,
}: {
  results: ProductRowData[];
  query: string;
}) {
  if (results.length === 0) {
    return (
      <p className="mt-12 text-center text-ink3" style={{ fontSize: 15 }}>
        No drinks match &quot;{query.trim()}&quot;
      </p>
    );
  }
  return (
    <>
      <p className="mx-4 mb-4 font-semibold text-ink3 lg:mx-0" style={{ fontSize: 13 }}>
        {results.length} result{results.length !== 1 ? "s" : ""} for &quot;
        {query.trim()}&quot;
      </p>
      <div className="mx-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:mx-0">
        {results.map((item) => (
          <ProductCard key={`${item.id}:${item.categorySlug}`} item={item} />
        ))}
      </div>
    </>
  );
}

export function MenuBrowser({ sections }: { sections: MenuBrowserSection[] }) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim().toLowerCase();
  const searching = trimmed.length > 0;

  // Mobile shows one category at a time, chosen via the chip bar.
  const [mobileCat, setMobileCat] = useState(() => sections[0]?.slug ?? "");

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

  const mobileSection =
    sections.find((s) => s.slug === mobileCat) ?? sections[0];

  return (
    <>
      <MenuHeader />

      {/* ===================== MOBILE ===================== */}
      <div className="lg:hidden">
        <div className="mx-4 mb-2 mt-2">
          <SearchField query={query} setQuery={setQuery} />
        </div>
        {searching ? (
          <div className="pb-4">
            <ResultsGrid results={searchResults} query={query} />
          </div>
        ) : (
          <>
            <ChipBar
              items={sidebarItems}
              active={mobileSection?.slug ?? ""}
              onSelect={setMobileCat}
            />
            <div className="pb-4 pt-3">
              {mobileSection && <CategorySection section={mobileSection} />}
            </div>
          </>
        )}
      </div>

      {/* ===================== DESKTOP ===================== */}
      <div className="hidden lg:grid lg:grid-cols-[234px_1fr] lg:gap-11 lg:px-4">
        <aside>
          <div className="sticky top-24 flex max-h-[calc(100vh-7rem)] flex-col overflow-y-auto pb-6">
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
            <ResultsGrid results={searchResults} query={query} />
          ) : (
            sections.map((section) => (
              <CategorySection key={section.slug} section={section} />
            ))
          )}
        </div>
      </div>
    </>
  );
}
