# Menu — Mobile Category Rail (app-parity)

**Date:** 2026-06-09
**Branch:** `feat/menu-mobile-category-rail`
**Scope:** Web only (`mandys_bubble_tea`). Frontend layout change to `/menu`.

## Problem

The web `/menu` page already has a desktop category sidebar (`CategorySidebar`,
sticky pill list with scroll-spy) — but it is gated `hidden lg:block`, so on
**mobile and tablet (< 1024px) there is no category navigation at all**: sections
just stack and the user scrolls the whole page. The native app menu, by contrast,
shows a permanent vertical category rail at all widths, so jumping between
categories is one tap. We want that same convenience on web mobile/tablet.

## Decisions (locked with user)

- **Interaction form:** permanent vertical rail, mirroring the app (not a
  collapsible drawer, not a horizontal sticky chip strip).
- **Breakpoint scope:** add the rail only at **< lg (mobile + tablet)**. The
  existing desktop (lg+) sidebar stays exactly as-is.
- **Scroll mechanism:** reuse the desktop pattern — `position: sticky` rail +
  window scroll + `IntersectionObserver` scroll-spy + `window.scrollTo`. Do **not**
  introduce nested inner-scroll containers (the app's native double-scroll model
  is fragile on mobile web: iOS address-bar resize, momentum scroll, conflict with
  the global cart bar). Sticky + window scroll is the proven web equivalent and is
  already what the desktop sidebar uses.

## Architecture

### 1. Extract shared hook — `useCategoryScrollSpy(items)`
New `src/components/menu/useCategoryScrollSpy.ts`. Lifts the existing behavior out
of `CategorySidebar`:
- `IntersectionObserver` over `#cat-<slug>` section anchors (rootMargin
  `-96px 0px -60% 0px`, threshold `[0, 0.2, 0.5]`) → tracks `active` slug.
- `scrollToCategory(slug)` → `window.scrollTo` to the section top minus an
  88px header offset, sets `active` optimistically.

Returns `{ active, scrollToCategory }`. Both the desktop sidebar and the new
mobile rail consume this — one scroll behavior, two presentations.

### 2. New `CategoryRail.tsx` (mobile, app-style)
New `src/components/menu/CategoryRail.tsx`. Narrow vertical column (~84px) styled
after the app rail (`mandys_bubble_tea_app` `menu.tsx` `tab` / `tabActive` /
`tabBar`):
- Each category = tappable row, label wraps to **2 lines** (`line-clamp-2`),
  centered.
- Active state = brand-color left bar + brand-color text (app parity), not the
  desktop pill style.
- Consumes `useCategoryScrollSpy`; tap → `scrollToCategory`.
- `<nav aria-label="Menu categories">` for a11y.

### 3. `CategorySidebar.tsx` refactor (no visual change)
Replace its inline observer/scroll logic with `useCategoryScrollSpy`. Pill-list
presentation (rounded pills, "Categories" label, dot + label, 220px) is byte-for-
byte unchanged — only the behavior source moves. Satisfies "keep desktop as-is".

### 4. `MenuBrowser.tsx` layout
Non-search branch only (search branch unchanged — full-width card grid, no rail):
- Change the wrapper from `lg:grid lg:grid-cols-[220px_1fr]` (sidebar hidden
  below lg) to a **two-column grid at all widths**:
  `grid grid-cols-[84px_1fr] gap-3 lg:grid-cols-[220px_1fr] lg:gap-6 lg:px-4`.
- Left column: one `<aside>` holding both rails, only one visible per breakpoint:
  - `CategoryRail` → `lg:hidden`
  - `CategorySidebar` → `hidden lg:block`
  - Each wrapped sticky (`sticky top-2` mobile / `sticky top-6` desktop) with
    `overflow-y-auto` and a max height so a long category list scrolls internally
    rather than overflowing: mobile `max-h-[calc(100vh-1rem)]`, desktop
    `max-h-[calc(100vh-3rem)]` (desktop value unchanged from today).
- Right column (content): sections stay, but the per-card/SectionHeader `mx-4`
  mobile gutters are removed/reduced — the rail now provides the left gutter, so
  content should not double-indent. Keep a small right padding so cards don't
  touch the screen edge.

## Out of scope / unchanged

- Search mode (full-width grid, no rail) — identical to today.
- `ProductCard`, `ProductRow`, data layer (`getMenu`, top10 presets), Square.
- Desktop (lg+) visuals and behavior.
- The native app repo (`mandys_bubble_tea_app`) — no changes.
- Collapsible/toggle affordance (the brown `>` handle in the reference shot) —
  explicitly not built; rail is permanent.

## Testing / verification

- **Unit:** `useCategoryScrollSpy` and `CategoryRail` are client/DOM components
  (IntersectionObserver, window.scrollTo); cover what is unit-testable in jsdom
  (rail renders all categories, active prop drives the left-bar/active class,
  tap calls the scroll callback with the right slug). Full scroll-spy is a
  real-DOM behavior — verify in browser, note as the integration gap.
- **Browser (cmux):** resize-pane to phone width (WKWebView can't set viewport;
  drive breakpoints via pane width, media queries read `clientWidth`). Verify:
  rail renders app-style, tap scrolls to section, scroll-spy highlights the
  current category, search mode still full-width. Then verify ≥1024px desktop =
  zero regression (pill sidebar untouched).
- **Regression:** full `vitest` suite + `tsc` clean.
