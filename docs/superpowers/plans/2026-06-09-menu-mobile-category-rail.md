# Menu Mobile Category Rail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permanent app-style vertical category rail to the web `/menu` page at mobile/tablet widths (< lg), reusing the desktop sidebar's scroll-spy behavior; desktop (lg+) sidebar is untouched.

**Architecture:** Extract the existing scroll-spy + scroll-to logic out of `CategorySidebar` into a shared hook `useCategoryScrollSpy`, called once in `MenuBrowser`. Both the desktop sidebar (unchanged pill visuals) and a new mobile `CategoryRail` (app-style narrow column) become controlled presentational components driven by the hook's `active` + `scrollToCategory`. `MenuBrowser` renders a two-column grid at all widths, swapping rail vs sidebar by breakpoint.

**Tech Stack:** Next.js (App Router) client components, React, Tailwind CSS v4. No new deps.

> **Testing convention (read first):** This repo's `vitest.config.ts` uses
> `environment: 'node'` and includes only `src/**/*.test.ts` — there is **no
> jsdom / React Testing Library**. UI is verified via the cmux browser, matching
> prior pure-UI Mandy work. So per-task verification here is `tsc` + targeted
> cmux browser checks; the full `vitest` suite + `tsc` is the regression gate at
> the end. Do **not** add `.test.tsx` / DOM unit tests — that would require new
> test infra (out of scope, against repo convention). The components in this plan
> are DOM-bound (IntersectionObserver / window.scrollTo) with no extractable pure
> logic to TDD.

**Branch:** `feat/menu-mobile-category-rail` (already created; spec at
`docs/superpowers/specs/2026-06-09-menu-mobile-category-rail-design.md`).

**Dev server:** running at `http://localhost:3010` (PORT=3010, since 3000 is
LURKY). Use this URL for all cmux browser checks.

---

### Task 1: Extract `useCategoryScrollSpy` hook + make `CategorySidebar` controlled

Lift the observer/scroll logic into a hook and convert `CategorySidebar` to a
controlled presentational component. **Desktop visuals/behavior must be
identical** after this task.

**Files:**
- Create: `src/components/menu/useCategoryScrollSpy.ts`
- Modify: `src/components/menu/CategorySidebar.tsx`
- Modify: `src/components/menu/MenuBrowser.tsx`

- [ ] **Step 1: Create the hook**

Create `src/components/menu/useCategoryScrollSpy.ts` — copy the exact observer
config and scroll math currently in `CategorySidebar.tsx` so behavior is
preserved byte-for-byte:

```tsx
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
```

- [ ] **Step 2: Convert `CategorySidebar` to controlled (props-driven)**

Replace the entire contents of `src/components/menu/CategorySidebar.tsx`. Remove
its `useState`/`useEffect`/`handleClick`; accept `active` + `onSelect` props. The
returned JSX (pill list, "Categories" label, dot + label, all classes/styles) is
**unchanged** — only the data source moves to props:

```tsx
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
            onClick={(e) => {
              e.preventDefault();
              onSelect(it.slug);
            }}
            className={
              "group flex items-center gap-2 rounded-full px-3 py-2 font-serif transition " +
              (isActive ? "bg-brand text-white" : "text-ink2 hover:bg-cream")
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
```

- [ ] **Step 3: Wire the hook in `MenuBrowser` and pass props to the sidebar**

In `src/components/menu/MenuBrowser.tsx`:

Add the import near the other menu imports:
```tsx
import { useCategoryScrollSpy } from "@/components/menu/useCategoryScrollSpy";
```

Inside the `MenuBrowser` component body, after the existing `sidebarItems`
`useMemo`, add:
```tsx
  const { active, scrollToCategory } = useCategoryScrollSpy(sidebarItems);
```

Then update the existing desktop `<CategorySidebar items={sidebarItems} />` usage
to pass the new props (this is the line inside the `<aside className="hidden lg:block">`):
```tsx
              <CategorySidebar
                items={sidebarItems}
                active={active}
                onSelect={scrollToCategory}
              />
```

(Leave the rest of the layout exactly as-is in this task — Task 3 changes the grid.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Browser regression — desktop sidebar unchanged**

In cmux, ensure a browser pane points at `http://localhost:3010/menu`. Set the
pane wide enough to be ≥1024px (desktop). Then:
- `cmux browser reload`
- `cmux browser errors list` → expect none
- `cmux browser console list` → expect no new errors/warnings
- `cmux browser screenshot --out /tmp/cmux-menu-desktop.png` → Read it; confirm
  the pill sidebar renders, "Categories" label present, one pill highlighted.
- Click a lower category pill via `cmux browser` (snapshot to find it, then
  click); confirm the page smooth-scrolls to that section and the highlight moves.

Expected: identical to pre-change desktop behavior.

- [ ] **Step 6: Commit**

```bash
git add src/components/menu/useCategoryScrollSpy.ts src/components/menu/CategorySidebar.tsx src/components/menu/MenuBrowser.tsx
git commit -m "refactor(menu): extract useCategoryScrollSpy, make CategorySidebar controlled"
```

---

### Task 2: New `CategoryRail` (mobile, app-style)

Create the narrow app-style rail. App parity reference (`mandys_bubble_tea_app`
`menu.tsx`): rail ≈ 24% width, each tab `minHeight 64`, centered, text 12/15 two
lines, active = `bg-paper` fill + 4px brand left bar + brand semibold text.

**Files:**
- Create: `src/components/menu/CategoryRail.tsx`

- [ ] **Step 1: Create the component**

```tsx
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors. (Component is not yet rendered anywhere; this just confirms
it compiles and the `CategorySidebarItem` import resolves.)

- [ ] **Step 3: Commit**

```bash
git add src/components/menu/CategoryRail.tsx
git commit -m "feat(menu): add app-style CategoryRail component for mobile"
```

---

### Task 3: Wire the rail into `MenuBrowser` layout

Switch the non-search layout to a two-column grid at all widths; show
`CategoryRail` below lg and `CategorySidebar` at lg+. Search mode is untouched.

**Files:**
- Modify: `src/components/menu/MenuBrowser.tsx`

- [ ] **Step 1: Import the rail**

Add near the other menu imports in `src/components/menu/MenuBrowser.tsx`:
```tsx
import { CategoryRail } from "@/components/menu/CategoryRail";
```

- [ ] **Step 2: Replace the non-search layout block**

Find the current non-search branch (the `else` of `searching ?`):
```tsx
        <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-6 lg:px-4">
          <aside className="hidden lg:block">
            <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pb-6">
              <CategorySidebar
                items={sidebarItems}
                active={active}
                onSelect={scrollToCategory}
              />
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
```

Replace it with (outer grid now active at all widths; left column holds both
rails, one visible per breakpoint; content children keep their existing
`mx-4 … lg:mx-0` gutters, which work inside the content column):
```tsx
        <div className="grid grid-cols-[84px_1fr] lg:grid-cols-[220px_1fr] lg:gap-6 lg:px-4">
          <aside>
            {/* Mobile / tablet rail */}
            <div className="sticky top-2 max-h-[calc(100vh-1rem)] overflow-y-auto pb-6 lg:hidden">
              <CategoryRail
                items={sidebarItems}
                active={active}
                onSelect={scrollToCategory}
              />
            </div>
            {/* Desktop sidebar */}
            <div className="sticky top-6 hidden max-h-[calc(100vh-3rem)] overflow-y-auto pb-6 lg:block">
              <CategorySidebar
                items={sidebarItems}
                active={active}
                onSelect={scrollToCategory}
              />
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
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Browser verify — mobile rail (the core check)**

In cmux, drive the breakpoint by pane width (WKWebView can't set viewport; media
queries read `clientWidth`). Resize the browser pane narrow enough that
`clientWidth < 1024` (aim ~390px-equivalent; remember the ~17px scrollbar — go a
bit under). At `http://localhost:3010/menu`:
- `cmux browser reload`
- `cmux browser errors list` and `cmux browser console list` → expect none new.
- `cmux browser screenshot --out /tmp/cmux-menu-mobile.png` → Read it. Confirm:
  narrow left rail with stacked 2-line category names (TOP 10, MILK TEA, FRUITY
  GREEN TEA, …), first category active (brand left bar + brand text + paper fill),
  card grid to the right not overlapping the rail.
- `cmux browser snapshot --compact` → grep that all category labels are present
  in the rail nav.
- Tap a lower category (e.g. "FROZEN") via `cmux browser` click; screenshot again
  → page scrolled to that section and the active highlight moved to it.
- Scroll the page manually (`cmux browser` evaluate `window.scrollTo` or wheel)
  past a section boundary → confirm scroll-spy moves the active rail item.

- [ ] **Step 5: Browser verify — search mode + desktop both intact**

- Type into the search box (`cmux browser fill`/`type`) → confirm the rail
  disappears and results are a full-width grid (search branch unchanged).
- Clear search → rail returns.
- Widen the pane to ≥1024px, reload → confirm desktop pill sidebar (220px) renders
  as before, rail gone. Screenshot `/tmp/cmux-menu-desktop-2.png` and Read.

- [ ] **Step 6: Full regression suite**

Run: `npx vitest run`
Expected: all pass (no menu logic changed; this guards against unrelated
breakage). Note any pre-existing failures unrelated to this change.

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/menu/MenuBrowser.tsx
git commit -m "feat(menu): show CategoryRail on mobile/tablet, two-column grid at all widths"
```

---

## Self-Review notes

- **Spec coverage:** hook extraction (Task 1) ✓; new CategoryRail app-style
  (Task 2) ✓; MenuBrowser two-column layout + sticky/overflow + breakpoint swap
  (Task 3) ✓; desktop unchanged (Task 1 keeps visuals, Task 3 keeps lg classes) ✓;
  search untouched (Task 3 only edits non-search branch) ✓; verification via cmux
  + tsc + vitest ✓.
- **Out of scope honored:** no collapse toggle, no app-repo changes, no data-layer
  changes, no DOM unit-test infra.
- **Type consistency:** `useCategoryScrollSpy(items: {slug}[])` → `{ active,
  scrollToCategory }`; both `CategorySidebar` and `CategoryRail` take
  `{ items, active, onSelect }`; `onSelect`/`scrollToCategory` signature
  `(slug: string) => void` matches across all call sites.
- **Tuning note:** rail width `84px` and font `12.5px` are starting values matched
  to app proportions (~24% width); if cards feel cramped at 375px in Step 4,
  adjust `grid-cols-[84px_1fr]` (e.g. 76–88px) — visual tune, no logic impact.
