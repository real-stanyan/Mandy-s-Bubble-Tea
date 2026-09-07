import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CategoryArt } from "@/components/brand/CategoryArt";
import { Reveal } from "@/components/motion/Reveal";
import { CATEGORY_ART_TINT, type CategoryArtKind } from "@/lib/menu/category-art";

// Browse the menu: the drink families as a grid of the living illustrations,
// each with its name and how many drinks it holds — the App's home grid
// (#135/#136), on the web. Tapping one lands on that family in the menu.
//
// The tint is the same in both themes; the names sit on the page beneath the
// drawing in theme ink, never over the art.

export type HomeCategory = {
  slug: string;
  label: string;
  kind: CategoryArtKind;
  /** Drinks in the family; null when the catalog could not be read. */
  count: number | null;
};

export function CategoriesGrid({ categories }: { categories: HomeCategory[] }) {
  if (categories.length === 0) return null;
  return (
    <section className="mx-auto w-full max-w-6xl px-5 pt-[72px] sm:px-8">
      <Reveal className="mb-8 flex items-end justify-between gap-5">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-brand">
            Browse the menu
          </p>
          <h2 className="mt-2 font-serif text-[clamp(28px,3.6vw,40px)] font-semibold tracking-[-0.02em] text-ink">
            Find your family
          </h2>
          <p className="mt-2 max-w-[460px] text-[14.5px] leading-relaxed text-ink2">
            Milk teas, fruit teas, fresh brews and the frozen shelf — pick a
            family and build your cup.
          </p>
        </div>
        <Link
          href="/menu"
          className="press inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-card px-4 py-2.5 text-[13px] font-semibold text-ink2 hover:bg-paper"
        >
          See all <ArrowRight size={15} />
        </Link>
      </Reveal>
      <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4">
        {categories.map((c, i) => (
          <Reveal key={c.slug} delay={(i % 4) * 70} scale className="flex">
            <Link
              // The menu browser reads this hash and opens that family — on
              // mobile it mounts one section at a time, so a plain anchor
              // would land on nothing.
              href={`/menu#cat-${c.slug}`}
              className="press group flex w-full flex-col"
              aria-label={`${c.label} — ${
                c.count == null ? "browse" : `${c.count} drinks`
              }`}
            >
              <div
                className="aspect-[1.9] overflow-hidden rounded-[14px] shadow-[var(--shadow-card-v)] transition group-hover:shadow-[0_18px_44px_rgba(42,30,20,0.14)]"
                // The one thing Tailwind cannot carry: the tint is data.
                style={{ backgroundColor: CATEGORY_ART_TINT[c.kind] }}
              >
                <CategoryArt kind={c.kind} crop="tile" />
              </div>
              <div className="pt-2">
                <p className="truncate font-serif text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                  {c.label}
                </p>
                <p className="mt-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink3">
                  {c.slug === "top-10"
                    ? "Most ordered"
                    : c.count == null
                      ? "Browse"
                      : `${c.count} drinks`}
                </p>
              </div>
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
