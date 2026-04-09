# Slice F — Home page rebrand

_Date: 2026-04-09_

## Problem

`src/app/page.tsx` is still the `create-next-app` template. It's the first
thing visitors hit at `mandybubbletea.com` and has zero brand identity,
no mention of the menu, and no mention of the loyalty program.

## Goals

1. Replace the template with a branded landing page that introduces the
   shop, points visitors at the menu, and teases the loyalty program.
2. Ship without any new imagery — use brand colors, typography, and the
   category images already in the Square catalog.
3. Stay consistent with `/menu` and `/checkout` visual style (brick-red
   header band, Tailwind-only styling, server-rendered with 5-minute
   revalidation).
4. No scope creep into slice G (shared header/nav) or slice I2 (already
   shipped). Home page only — `layout.tsx` stays untouched.

## Non-goals

- Shared header component (that's slice G).
- Hours of operation (data isn't in the project yet).
- Testimonials, "about us", blog, animations, dark mode.

## Design

### Page structure (top to bottom)

**1. Header band** — brick-red bar, name on the left, right-aligned
links (`Menu`, `Account`) + `<CartIcon />`. Matches the header on
`/menu` and `/checkout`. Inline in `page.tsx` — not extracted.

**2. Hero section** — full-width brick-red block.
- Oversized headline: "Mandy's Bubble Tea"
- Subtitle: "Freshly made bubble tea, brewed daily in Southport."
- Primary CTA (cream fill, brick-red text): "Order Now →" → `/menu`
- Secondary text link: "View rewards" → `/account`

**3. Featured categories** — white background.
- Heading: "Explore the menu"
- Show up to 3 non-empty categories from `getMenu()`, using
  `imageUrl` + `squareName` + item count. Each card links to
  `/menu/[slug]`.
- Tail link: "See full menu →" → `/menu`
- If `getMenu()` throws, degrade to a single "See our menu →" link —
  the hero + loyalty + visit sections still render.

**4. Loyalty teaser** — cream (`#F5E6C8`) background.
- Heading: "Earn stars. Drink free."
- Body: "1 drink = 1 ⭐. Collect 9 ⭐ for a free drink of your choice
  — across all categories."
- Visual: 9 brick-red stars in a row (pure Unicode, no SVG).
- CTA: "Check your stars" → `/account`

**5. Visit us** — white background.
- Address, phone, "Pickup only" label.
- Google Maps link:
  `https://maps.google.com/?q=34+Davenport+St+Southport+QLD+4215`
- Data pulled from `BUSINESS` in `lib/constants.ts`.

**6. Footer** — light grey band. Name, `© 2026`, "Powered by Square".

### Data + rendering

- `page.tsx` becomes an `async` Server Component.
- Calls `getMenu()` server-side for the featured categories.
- `export const revalidate = 300` — mirrors `/menu`.
- No client JS on this page beyond `<CartIcon />` (already a client
  component).

### Error handling

- `getMenu()` wrapped in try/catch. On failure, featured section shows
  the "See our menu →" fallback; the rest of the page is unaffected.
  Failing the whole page for a catalog hiccup would be worse than
  showing a slightly degraded home page.

### Files touched

- `src/app/page.tsx` — full rewrite.
- No new files. No edits to `layout.tsx`, `constants.ts`, or any
  existing component.

## Risks / trade-offs

- **No real product photography.** The hero relies on brand color +
  typography. This is the honest trade-off for shipping without new
  assets; once photos exist, swapping in a hero image is a localized
  change.
- **Inline sections, no component extraction.** Each section is used
  exactly once. Abstracting them into `components/home/*` would add
  files without a second caller. Accept the inline JSX and extract
  later only if a second consumer appears.
- **Featured categories show whatever the catalog returns.** No
  curation logic. If Square returns the categories in an unhelpful
  order, we revisit — but probably never.
