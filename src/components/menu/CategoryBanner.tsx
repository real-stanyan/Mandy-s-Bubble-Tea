import { CategoryArt } from "@/components/brand/CategoryArt";
import { CATEGORY_ART_TINT, categoryArtKind } from "@/lib/menu/category-art";

// The menu's section head, the way the App draws it (#136/#137): the category
// name and its count on a pastel card, with the family's living illustration
// in the band beneath them. A family Square has that we have never drawn falls
// back to the plain heading — never an empty coloured box.
//
// The pastel is the same in both themes, so the type on it is pinned to day
// ink rather than the theme token (the App's PIN rule) — hence the literal
// inks below instead of text-ink / text-ink3, which would turn parchment after
// sunset and vanish into the pastel.
//
// The layout follows the CARD's width, not the window's: this banner sits in a
// phone-width column on one page and a 1000px one on another, and a viewport
// breakpoint gets both wrong. Hence @container.

type Props = {
  /** Square's own category name — what the customer reads. */
  name: string;
  /** Drinks in the family. */
  count: number;
  /** The family's line of marketing copy, kept under the card. */
  blurb?: string;
  /** Extra line on the specials shelf ("this week only"). */
  note?: string;
};

export function CategoryBanner({ name, count, blurb, note }: Props) {
  const kind = categoryArtKind(name);
  const sub = `${count} ${count === 1 ? "drink" : "drinks"}${note ? ` · ${note}` : ""}`;

  if (!kind) {
    return (
      <div>
        <h2 className="font-serif text-[28px] font-semibold tracking-[-0.6px] text-ink">
          {name}
        </h2>
        <p className="mt-1 text-[14px] text-ink3">{blurb ?? sub}</p>
      </div>
    );
  }

  return (
    <div className="@container">
      <div
        className="relative h-[144px] overflow-hidden rounded-card shadow-[var(--shadow-card-v)] @min-[420px]:h-[164px] @min-[560px]:h-[152px]"
        // The one thing Tailwind cannot carry: the tint is data.
        style={{ backgroundColor: CATEGORY_ART_TINT[kind] }}
      >
        {/* Narrow: the name on the row above the drawing, never over it. Wide:
            the name keeps to the left half and centres against the drawing, so
            a long family name cannot run across it. */}
        <div className="relative z-[1] px-4 pt-3 @min-[560px]:flex @min-[560px]:h-full @min-[560px]:w-[52%] @min-[560px]:flex-col @min-[560px]:justify-center @min-[560px]:px-7 @min-[560px]:pt-0">
          <h2 className="truncate font-serif text-[26px] font-semibold leading-[30px] tracking-[-0.6px] text-[#2A1E14] @min-[560px]:text-[32px] @min-[560px]:leading-[36px]">
            {name}
          </h2>
          <p className="mt-0.5 truncate font-mono text-[10.5px] font-bold uppercase tracking-[1.2px] text-[rgba(42,30,20,0.55)]">
            {sub}
          </p>
        </div>
        {/* A band that wide and that short would strand the drawing in the
            middle of an empty field, so past 560px it moves beside the name and
            takes the card's full height instead. */}
        <div className="absolute inset-x-0 bottom-0 top-[54px] @min-[420px]:top-[62px] @min-[560px]:inset-y-0 @min-[560px]:left-auto @min-[560px]:w-[46%]">
          <CategoryArt kind={kind} />
        </div>
      </div>
      {blurb && <p className="mt-2.5 text-[14px] text-ink3">{blurb}</p>}
    </div>
  );
}
