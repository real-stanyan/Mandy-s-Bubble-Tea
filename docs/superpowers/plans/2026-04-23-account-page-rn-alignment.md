# Account Page — RN Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the web `/account` page to visually match the RN app's Account screen 1:1, ship Fraunces/Inter/JetBrains-Mono Google Fonts, switch the global brand color from brick-red `#C43A10` to brown `#8D5524`, swap `<body>` bg to `#F2E8DF`, and port all 12 RN account sub-components.

**Architecture:** Tailwind v4 `@theme` extension in `globals.css` (project already uses v4 via `@import "tailwindcss"`). Single-column `max-w-md` page ("web viewport of the app"). Components mirror the RN structure under `src/components/account/` + `src/components/brand/`. Loyalty events sourced from existing `/api/loyalty/events` via a client hook. Account deletion reuses existing `/api/account/delete`.

**Tech Stack:** Next.js 16.2.3 / React 19.2.4 / Tailwind CSS v4 / Supabase Auth / `qrcode.react` / `lucide-react` (new) / `@radix-ui/react-alert-dialog` (already installed) / `next/font/google`.

**Spec:** `docs/superpowers/specs/2026-04-23-account-page-rn-alignment-design.md` (commit `3d74f56`).

**Reference screenshot:** user-supplied Image #27 (2026-04-23 19:32, RN account screen on iPhone).

---

## File Structure

New files:
- `src/components/brand/StarCupsRow.tsx`
- `src/components/brand/AppleLogoIcon.tsx`
- `src/components/account/AccountHeader.tsx`
- `src/components/account/LoyaltyCard.tsx`
- `src/components/account/MiniStats.tsx`
- `src/components/account/PromotionsCard.tsx`
- `src/components/account/OrderHistory.tsx`
- `src/components/account/OrderRow.tsx`
- `src/components/account/ActivityHistory.tsx`
- `src/components/account/StoreInfo.tsx`
- `src/components/account/LegalFooter.tsx`
- `src/components/account/SignOutBtn.tsx`
- `src/components/account/DeleteAccountBtn.tsx`
- `src/hooks/use-loyalty-events.ts`
- `src/app/account/orders/page.tsx` (new route for "See all Past Orders")

Modified files:
- `package.json` (add `lucide-react`)
- `src/app/globals.css` (Tailwind v4 `@theme` — add brand tokens, radius, shadow, font vars)
- `src/app/layout.tsx` (swap Geist → Fraunces/Inter/JetBrains Mono, update `themeColor`)
- `src/lib/constants.ts` (`BRAND.primaryColor` `#C43A10` → `#8D5524`; `BRAND.bgColor` `#F9F6EE` → `#F2E8DF`)
- `src/components/account/MemberQrCard.tsx` (rewrite to RN row layout + expand modal)
- `src/components/account/AddToWalletButton.tsx` (rewrite external chrome; keep exchange/polling logic)
- `src/components/account/WelcomeDiscountCard.tsx` (swap chrome to token palette)
- `src/components/auth/AuthProvider.tsx` (add `deleteAccount` method)
- `src/app/account/page.tsx` (rewrite signed-in dashboard section; keep sign-in / loading branches)

Out of scope (do NOT touch this pass):
- `src/lib/wallet/constants.ts` (Apple Wallet pass strip color — separate decision)
- Home / menu / cart / checkout / order-confirmation layouts (inherit color only)
- Global `SiteFooter` component (account page has its own `LegalFooter`)

---

## Task 1: Add lucide-react dependency

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npm install lucide-react
```

- [ ] **Step 2: Verify**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
node -e "console.log(require('lucide-react/package.json').version)"
```
Expected: prints a version string (e.g. `0.xxx.x`).

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add package.json package-lock.json
git commit -m "chore(deps): add lucide-react for account page icons"
```

---

## Task 2: Extend Tailwind v4 theme with brand tokens

**Files:**
- Modify: `src/app/globals.css`

This project uses Tailwind v4 — theme config lives in CSS via `@theme inline`, not `tailwind.config.ts`.

- [ ] **Step 1: Replace `globals.css` contents**

```css
@import "tailwindcss";

:root {
  --background: #F2E8DF;
  --foreground: #2A1E14;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);

  --color-bg: #F2E8DF;
  --color-bg2: #E8DAC6;
  --color-paper: #FFF9F0;
  --color-card: #FFFFFF;
  --color-ink: #2A1E14;
  --color-ink2: #5A4330;
  --color-ink3: rgba(42, 30, 20, 0.55);
  --color-ink4: rgba(42, 30, 20, 0.28);
  --color-line: rgba(42, 30, 20, 0.10);
  --color-brand: #8D5524;
  --color-brand-dark: #6B3E15;
  --color-peach: #FFB380;
  --color-cream: #FFF3DE;
  --color-star: #F2B64A;
  --color-sage: #A2AD91;
  --color-green: #3CA96E;
  --color-green-dark: #2E7F52;

  --radius-card: 20px;
  --radius-tile: 12px;
  --radius-small: 10px;

  --shadow-card: 0 2px 8px rgba(42, 30, 20, 0.04);
  --shadow-mini-cart: 0 10px 20px rgba(107, 62, 21, 0.55);
  --shadow-primary-cta: 0 14px 24px rgba(42, 30, 20, 0.55);

  --font-serif: var(--font-fraunces);
  --font-sans: var(--font-inter);
  --font-mono: var(--font-jetbrains-mono);
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #F2E8DF;
    --foreground: #2A1E14;
  }
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-inter), system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-text-size-adjust: 100%;
}

.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

@media (max-width: 639px) {
  input[type="text"],
  input[type="tel"],
  input[type="email"],
  select,
  textarea {
    font-size: 16px;
  }
}

/* Alert dialog open/close transitions (driven by radix data-state) */
@keyframes mbt-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes mbt-fade-out { from { opacity: 1 } to { opacity: 0 } }
@keyframes mbt-scale-in {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.95) }
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1) }
}
@keyframes mbt-scale-out {
  from { opacity: 1; transform: translate(-50%, -50%) scale(1) }
  to   { opacity: 0; transform: translate(-50%, -50%) scale(0.95) }
}
.mbt-dialog-overlay[data-state="open"]  { animation: mbt-fade-in 150ms ease-out }
.mbt-dialog-overlay[data-state="closed"]{ animation: mbt-fade-out 100ms ease-in }
.mbt-dialog-content[data-state="open"]  { animation: mbt-scale-in 180ms ease-out }
.mbt-dialog-content[data-state="closed"]{ animation: mbt-scale-out 120ms ease-in }
```

Tailwind v4 will now expose `bg-brand`, `bg-brand-dark`, `text-ink`, `text-ink2`, `text-ink3`, `border-line`, `rounded-card`, `rounded-tile`, `shadow-card`, `shadow-mini-cart`, `font-serif`, `font-mono`, etc.

- [ ] **Step 2: Typecheck still passes**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0 (or pre-existing errors only — NO new errors introduced by this change).

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/app/globals.css
git commit -m "feat(theme): add brand token infrastructure via Tailwind v4 @theme"
```

---

## Task 3: Swap fonts + themeColor in `layout.tsx`

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Replace font imports and root html/body**

Replace `src/app/layout.tsx` with:

```tsx
import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { SiteHeaderGate } from "@/components/layout/SiteHeaderGate";
import { SiteFooterGate } from "@/components/layout/SiteFooterGate";
import { AuthProvider } from "@/components/auth/AuthProvider";

const fraunces = Fraunces({
  weight: ["500", "600"],
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

const inter = Inter({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  weight: ["700"],
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Mandy's Bubble Tea",
    template: "%s | Mandy's Bubble Tea",
  },
  description:
    "Fresh bubble tea in Southport QLD — order online for pickup at 34 Davenport St, Southport.",
  openGraph: {
    type: "website",
    siteName: "Mandy's Bubble Tea",
    locale: "en_AU",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#8D5524",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Restaurant",
  name: "Mandy's Bubble Tea",
  description:
    "Fresh bubble tea in Southport QLD — milky teas, fruity teas, fresh brews, frozen drinks and more.",
  url: "https://mandybubbletea.com",
  telephone: "+61404978238",
  address: {
    "@type": "PostalAddress",
    streetAddress: "34 Davenport St",
    addressLocality: "Southport",
    addressRegion: "QLD",
    postalCode: "4215",
    addressCountry: "AU",
  },
  servesCuisine: "Bubble Tea",
  currenciesAccepted: "AUD",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-bg text-ink">
        <AuthProvider>
          <SiteHeaderGate />
          {children}
          <SiteFooterGate />
          <CartDrawer />
        </AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0 (no new errors).

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/app/layout.tsx
git commit -m "feat(fonts): swap Geist → Fraunces/Inter/JetBrains Mono, align themeColor with brand"
```

---

## Task 4: Swap BRAND.primaryColor + bgColor

**Files:**
- Modify: `src/lib/constants.ts`

- [ ] **Step 1: Update BRAND block**

In `src/lib/constants.ts`, change:

```ts
export const BRAND = {
  name: "Mandy's Bubble Tea",
  primaryColor: "#C43A10", // brick red
  accentColor: "#F5E6C8", // cream
  bgColor: "#F9F6EE", // warm off-white page background
} as const;
```

to:

```ts
export const BRAND = {
  name: "Mandy's Bubble Tea",
  primaryColor: "#8D5524", // warm brown (aligned with RN app)
  accentColor: "#FFF3DE", // cream
  bgColor: "#F2E8DF", // warm beige page background
} as const;
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/lib/constants.ts
git commit -m "feat(brand): switch primary to #8D5524 brown, bg to #F2E8DF beige"
```

---

## Task 5: StarCupsRow SVG component

**Files:**
- Create: `src/components/brand/StarCupsRow.tsx`

- [ ] **Step 1: Create component**

```tsx
// Nine bubble-tea cups rendered inline as SVG — used in LoyaltyCard to
// show stars collected toward the current reward. `value` cups are
// filled with peach; the rest show a faint outline.
//
// Shape mirrors the RN app's brand/StarCupsRow.tsx — simplified cup
// silhouette that reads well even at 22px wide.

type StarCupsRowProps = {
  value: number;
  total: number;
  className?: string;
};

export function StarCupsRow({ value, total, className }: StarCupsRowProps) {
  const filled = Math.max(0, Math.min(value, total));

  return (
    <div
      className={
        "mt-[18px] flex justify-between gap-1 " + (className ?? "")
      }
      aria-label={`${filled} of ${total} stars`}
    >
      {Array.from({ length: total }).map((_, i) => (
        <Cup key={i} filled={i < filled} />
      ))}
    </div>
  );
}

function Cup({ filled }: { filled: boolean }) {
  return (
    <svg
      width="22"
      height="26"
      viewBox="0 0 22 26"
      fill="none"
      aria-hidden="true"
    >
      {/* Lid */}
      <path
        d="M3 4 H19 L18 7 H4 Z"
        fill={filled ? "#FFB380" : "none"}
        stroke={filled ? "#FFB380" : "rgba(255,255,255,0.4)"}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* Body */}
      <path
        d="M4 8 L5 22 Q5 24 7 24 H15 Q17 24 17 22 L18 8 Z"
        fill={filled ? "#FFB380" : "none"}
        stroke={filled ? "#FFB380" : "rgba(255,255,255,0.4)"}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* Straw */}
      <path
        d="M11 2 L11 7"
        stroke={filled ? "#FFF3DE" : "rgba(255,255,255,0.4)"}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/components/brand/StarCupsRow.tsx
git commit -m "feat(brand): add StarCupsRow SVG component"
```

---

## Task 6: AppleLogoIcon component

**Files:**
- Create: `src/components/brand/AppleLogoIcon.tsx`

- [ ] **Step 1: Create component**

```tsx
// Apple logo mark used in the Add-to-Wallet CTA. lucide-react has no
// Apple glyph — this is a minimal inline path, 14px default.

type AppleLogoIconProps = {
  size?: number;
  className?: string;
};

export function AppleLogoIcon({ size = 14, className }: AppleLogoIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M17.564 12.875c-.024-2.401 1.962-3.557 2.052-3.612-1.119-1.636-2.86-1.86-3.481-1.885-1.483-.15-2.893.875-3.645.875-.752 0-1.913-.853-3.145-.83-1.618.023-3.113.941-3.947 2.391-1.682 2.917-.43 7.237 1.21 9.605.803 1.159 1.762 2.459 3.014 2.412 1.208-.05 1.666-.783 3.128-.783 1.462 0 1.875.783 3.15.76 1.3-.024 2.125-1.18 2.921-2.344.921-1.345 1.302-2.648 1.326-2.715-.029-.013-2.545-.977-2.583-3.874zM15.132 5.82c.668-.81 1.12-1.932.996-3.048-.964.04-2.13.642-2.82 1.45-.618.717-1.16 1.863-1.014 2.956 1.074.083 2.17-.548 2.838-1.358z" />
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/components/brand/AppleLogoIcon.tsx
git commit -m "feat(brand): add AppleLogoIcon inline SVG for wallet CTA"
```

---

## Task 7: AccountHeader

**Files:**
- Create: `src/components/account/AccountHeader.tsx`

- [ ] **Step 1: Create component**

```tsx
import type { AuthProfile } from "@/components/auth/AuthProvider";

type AccountHeaderProps = {
  profile: AuthProfile;
};

export function AccountHeader({ profile }: AccountHeaderProps) {
  const fullName =
    [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
    "Member";
  const initials = computeInitials(profile.first_name, profile.last_name);

  return (
    <div className="flex items-center gap-3.5 px-4 pt-2 pb-3">
      <div
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-peach to-brand"
        style={{ boxShadow: "0 6px 14px rgba(141,85,36,0.45)" }}
      >
        <span
          className="font-serif text-white"
          style={{ fontSize: 22, letterSpacing: -0.5 }}
        >
          {initials}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <h1
          className="font-serif text-ink truncate"
          style={{ fontSize: 22, letterSpacing: -0.5, fontWeight: 500 }}
        >
          {fullName}
        </h1>
        <p
          className="font-mono text-ink3 mt-0.5 truncate"
          style={{ fontSize: 12 }}
        >
          {formatPhone(profile.phone_e164)}
        </p>
      </div>
    </div>
  );
}

function computeInitials(
  first: string | null,
  last: string | null,
): string {
  const a = first?.trim()?.[0] ?? "";
  const b = last?.trim()?.[0] ?? "";
  const initials = `${a}${b}`.toUpperCase();
  return initials || "🧋";
}

function formatPhone(e164: string): string {
  if (!e164) return "";
  if (!e164.startsWith("+61")) return e164;
  const local = `0${e164.slice(3).replace(/^0+/, "")}`;
  if (local.length !== 10) return e164;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/components/account/AccountHeader.tsx
git commit -m "feat(account): add AccountHeader (avatar + name + phone)"
```

---

## Task 8: LoyaltyCard

**Files:**
- Create: `src/components/account/LoyaltyCard.tsx`

- [ ] **Step 1: Create component**

```tsx
import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import { StarCupsRow } from "@/components/brand/StarCupsRow";

type LoyaltyCardProps = {
  balance: number;
  starsPerReward: number;
};

export function LoyaltyCard({ balance, starsPerReward }: LoyaltyCardProps) {
  const goal = starsPerReward > 0 ? starsPerReward : 1;
  const currentStars = balance % goal;
  const toGo = Math.max(0, goal - currentStars);
  const reached = balance >= goal;

  return (
    <div className="px-4 mt-3">
      <Link
        href="/account/promotions"
        className="block rounded-card bg-gradient-to-br from-brand to-brand-dark p-[22px] shadow-mini-cart transition-transform active:scale-[0.985]"
      >
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-peach" />
              <span
                className="font-mono uppercase text-white/70"
                style={{
                  fontSize: 10.5,
                  letterSpacing: 1.3,
                  fontWeight: 700,
                }}
              >
                MANDY&apos;S REWARDS
              </span>
            </div>
            <div className="mt-2 flex items-baseline">
              <span
                className="font-serif text-white"
                style={{
                  fontSize: 36,
                  lineHeight: "36px",
                  letterSpacing: -0.8,
                  fontWeight: 500,
                }}
              >
                {balance}
              </span>
              <span
                className="font-serif text-white/45 ml-1.5"
                style={{ fontSize: 24, fontWeight: 500 }}
              >
                {` / ${goal} stars`}
              </span>
            </div>
          </div>
          <span className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1.5">
            <Star size={12} className="text-peach" fill="currentColor" />
            <span
              className="text-white"
              style={{ fontSize: 11, fontWeight: 500 }}
            >
              Member
            </span>
          </span>
        </div>

        <StarCupsRow value={currentStars} total={goal} />

        <div className="mt-[18px] flex items-center justify-between">
          <p
            className="flex-1 pr-3 text-white/85"
            style={{ fontSize: 13, lineHeight: "19px" }}
          >
            {reached ? (
              <>🎉 Free drink ready to redeem</>
            ) : (
              <>
                <span
                  className="text-white"
                  style={{ fontWeight: 600 }}
                >
                  {toGo}
                </span>
                {" stars until a free drink"}
              </>
            )}
          </p>
          <span
            className={
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 " +
              (reached ? "bg-peach" : "bg-white/20")
            }
          >
            <span
              className={reached ? "text-brand-dark" : "text-white"}
              style={{ fontSize: 12.5, fontWeight: 500 }}
            >
              {reached ? "Redeem" : "View"}
            </span>
            <ArrowRight
              size={12}
              className={reached ? "text-brand-dark" : "text-white"}
            />
          </span>
        </div>
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/components/account/LoyaltyCard.tsx
git commit -m "feat(account): add brown-gradient LoyaltyCard with cup row + inline CTA"
```

---

## Task 9: MiniStats

**Files:**
- Create: `src/components/account/MiniStats.tsx`

- [ ] **Step 1: Create component**

```tsx
type MiniStatsProps = {
  drinks: number;
  rewards: number;
  stars: number;
  onPressDrinks?: () => void;
  onPressRewards?: () => void;
};

export function MiniStats({
  drinks,
  rewards,
  stars,
  onPressDrinks,
  onPressRewards,
}: MiniStatsProps) {
  return (
    <div className="flex gap-2.5 px-4 mt-3">
      <Tile n={drinks} label="Drinks" onClick={onPressDrinks} />
      <Tile n={rewards} label="Rewards" onClick={onPressRewards} />
      <Tile n={stars} label="Stars" />
    </div>
  );
}

type TileProps = {
  n: number;
  label: string;
  onClick?: () => void;
};

function Tile({ n, label, onClick }: TileProps) {
  const content = (
    <>
      <span
        className="block font-serif text-ink"
        style={{
          fontSize: 22,
          lineHeight: "24px",
          letterSpacing: -0.4,
          fontWeight: 500,
        }}
      >
        {n}
      </span>
      <span
        className="block font-mono uppercase text-ink3 mt-1"
        style={{
          fontSize: 10.5,
          letterSpacing: 1.3,
          fontWeight: 700,
        }}
      >
        {label}
      </span>
    </>
  );

  if (!onClick) {
    return (
      <div className="flex-1 rounded-tile border border-line bg-paper py-3 px-2.5">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-tile border border-line bg-paper py-3 px-2.5 text-left transition active:opacity-75 active:bg-cream"
    >
      {content}
    </button>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/components/account/MiniStats.tsx
git commit -m "feat(account): add MiniStats three-tile row (Drinks/Rewards/Stars)"
```

---

## Task 10: Rewrite MemberQrCard to row layout + expand modal

**Files:**
- Modify: `src/components/account/MemberQrCard.tsx` (full rewrite)

- [ ] **Step 1: Replace contents**

```tsx
"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ChevronRight } from "lucide-react";

type MemberQrCardProps = {
  customerId: string;
  phoneE164: string;
};

export function MemberQrCard({ customerId, phoneE164 }: MemberQrCardProps) {
  const [open, setOpen] = useState(false);
  if (!customerId || !phoneE164) return null;

  const memberId = `M-${customerId.slice(-8).toUpperCase()}`;

  return (
    <>
      <div className="px-4 mt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-3.5 rounded-card border border-line bg-paper p-4 text-left transition active:opacity-90"
          aria-label="Expand member QR"
        >
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-line bg-white p-1.5">
            <QRCodeSVG value={phoneE164} size={84} level="M" />
          </div>
          <div className="min-w-0 flex-1">
            <span
              className="block font-mono uppercase text-brand"
              style={{
                fontSize: 10.5,
                letterSpacing: 1.4,
                fontWeight: 700,
              }}
            >
              MEMBER QR
            </span>
            <span
              className="mt-1 block font-serif text-ink"
              style={{
                fontSize: 17,
                lineHeight: "20px",
                letterSpacing: -0.3,
                fontWeight: 500,
              }}
            >
              Scan at the counter
            </span>
            <span
              className="mt-1 block truncate font-mono text-ink3"
              style={{ fontSize: 11.5, fontWeight: 700 }}
            >
              {memberId}
            </span>
            <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1.5">
              <span
                className="text-cream"
                style={{ fontSize: 11.5, fontWeight: 600 }}
              >
                Expand
              </span>
              <ChevronRight size={10} className="text-cream" />
            </span>
          </div>
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex flex-col items-center gap-3 rounded-card bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <QRCodeSVG value={phoneE164} size={260} level="M" />
            <span
              className="font-mono text-ink"
              style={{ fontSize: 14, letterSpacing: 1.5, fontWeight: 700 }}
            >
              {memberId}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-1 rounded-full bg-ink px-5 py-2.5 text-cream transition active:opacity-80"
              style={{ fontSize: 13, fontWeight: 600 }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/components/account/MemberQrCard.tsx
git commit -m "feat(account): rewrite MemberQrCard to RN row layout + expand modal"
```

---

## Task 11: Rewrite AddToWalletButton external chrome (keep logic)

**Files:**
- Modify: `src/components/account/AddToWalletButton.tsx` (full rewrite preserving behavior)

- [ ] **Step 1: Replace contents**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard } from "lucide-react";
import { AppleLogoIcon } from "@/components/brand/AppleLogoIcon";

type State = "idle" | "loading" | "polling" | "added" | "error";

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Firefox/.test(ua)) {
    return true;
  }
  return false;
}

async function fetchStatus(): Promise<boolean> {
  try {
    const r = await fetch("/api/wallet/pass/status", { cache: "no-store" });
    if (!r.ok) return false;
    const j = (await r.json()) as { added?: boolean };
    return Boolean(j.added);
  } catch {
    return false;
  }
}

export function AddToWalletButton() {
  const [show, setShow] = useState(false);
  const [state, setState] = useState<State>("idle");
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    setShow(isApplePlatform());
  }, []);

  useEffect(() => {
    if (!show) return;
    fetchStatus().then((added) => {
      if (added) setState("added");
    });
  }, [show]);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    setState("polling");
    const startedAt = Date.now();
    pollRef.current = window.setInterval(async () => {
      const added = await fetchStatus();
      if (added) {
        stopPolling();
        setState("added");
        return;
      }
      if (Date.now() - startedAt > 30_000) {
        stopPolling();
        setState("idle");
      }
    }, 2000);
  }, [stopPolling]);

  useEffect(() => {
    function onPageShow() {
      if (state === "loading" || state === "polling") startPolling();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      stopPolling();
    };
  }, [state, startPolling, stopPolling]);

  const onClick = useCallback(async () => {
    if (state === "added") {
      // "Open" — no reliable desktop action, so we just try the shoebox:// scheme; harmless on non-iOS.
      try {
        window.location.href = "shoebox://";
      } catch {
        // no-op
      }
      return;
    }
    setState("loading");
    try {
      const res = await fetch("/api/wallet/pass/exchange", { method: "POST" });
      if (!res.ok) throw new Error(`exchange ${res.status}`);
      const { token } = (await res.json()) as { token: string };
      startPolling();
      window.location.href = `/api/wallet/pass?token=${encodeURIComponent(token)}`;
    } catch {
      setState("error");
    }
  }, [state, startPolling]);

  if (!show) return null;

  const busy = state === "loading" || state === "polling";
  const added = state === "added";
  const subtitle = added
    ? "Added to Apple Wallet"
    : state === "polling"
      ? "Waiting for Wallet to confirm…"
      : state === "loading"
        ? "Preparing your card…"
        : state === "error"
          ? "Couldn't generate pass. Try again."
          : "Scan at the counter — updates automatically";

  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-card bg-paper p-3 shadow-card">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-tile bg-bg">
        <CreditCard size={20} className="text-ink2" />
      </div>
      <div className="min-w-0 flex-1">
        <span
          className="block font-serif text-ink"
          style={{
            fontSize: 17,
            letterSpacing: -0.3,
            fontWeight: 500,
          }}
        >
          Save your member card
        </span>
        <span className="mt-0.5 block text-ink3" style={{ fontSize: 13 }}>
          {subtitle}
        </span>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="flex h-9 min-w-[90px] items-center justify-center gap-1.5 rounded-full bg-ink px-3.5 text-white transition active:opacity-80 disabled:opacity-70"
      >
        {busy ? (
          <span
            className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
            aria-label="Loading"
          />
        ) : (
          <>
            <AppleLogoIcon size={14} className="text-white" />
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              {added ? "Open" : "Add to Wallet"}
            </span>
          </>
        )}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/components/account/AddToWalletButton.tsx
git commit -m "feat(account): rewrite AddToWalletButton chrome (card + Apple pill)"
```

---

## Task 12: Rewrite WelcomeDiscountCard chrome

**Files:**
- Modify: `src/components/account/WelcomeDiscountCard.tsx` (full rewrite)

- [ ] **Step 1: Replace contents**

```tsx
"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";

export function WelcomeDiscountCard() {
  const { welcomeDiscount } = useAuth();
  if (!welcomeDiscount.available) return null;

  const { percentage, drinksRemaining } = welcomeDiscount;
  const remainingLabel =
    drinksRemaining === 1 ? "1 drink left" : `${drinksRemaining} drinks left`;

  return (
    <div className="px-4 mt-3">
      <section
        className="relative overflow-hidden rounded-card border border-line bg-paper p-4"
        aria-label="Welcome discount"
      >
        <div className="pointer-events-none absolute -right-6 -top-6 h-32 w-32 rounded-full bg-peach/30" />
        <div className="relative flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p
              className="font-mono uppercase text-brand"
              style={{
                fontSize: 10.5,
                letterSpacing: 1.3,
                fontWeight: 700,
              }}
            >
              Welcome Gift
            </p>
            <h3
              className="mt-1 font-serif text-ink"
              style={{
                fontSize: 26,
                letterSpacing: -0.5,
                fontWeight: 500,
              }}
            >
              {percentage}% OFF
            </h3>
            <p
              className="mt-1 text-ink2"
              style={{ fontSize: 13, lineHeight: "18px" }}
            >
              Your first 2 drinks — {remainingLabel}, auto-applied at checkout.
            </p>
          </div>
          <Link
            href="/menu"
            className="flex shrink-0 items-center gap-1 rounded-full bg-ink px-4 py-2 text-cream transition active:opacity-85"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            Menu
            <ArrowRight size={12} />
          </Link>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/components/account/WelcomeDiscountCard.tsx
git commit -m "feat(account): retune WelcomeDiscountCard to token palette"
```

---

## Task 13: PromotionsCard

**Files:**
- Create: `src/components/account/PromotionsCard.tsx`

- [ ] **Step 1: Create component**

```tsx
import Link from "next/link";
import { ChevronRight, Gift } from "lucide-react";

type PromotionsCardProps = {
  rewardsCount: number;
};

export function PromotionsCard({ rewardsCount }: PromotionsCardProps) {
  if (rewardsCount <= 0) return null;
  const label = `${rewardsCount} free drink${rewardsCount === 1 ? "" : "s"} ready`;

  return (
    <div className="px-4 mt-3">
      <Link
        href="/account/promotions"
        className="flex items-center gap-3 rounded-card border p-4 transition active:opacity-90"
        style={{
          background: "linear-gradient(135deg, #FFB380 0%, #FFF3DE 100%)",
          borderColor: "rgba(141,85,36,0.12)",
        }}
      >
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-ink"
        >
          <Gift size={22} className="text-cream" />
        </div>
        <div className="min-w-0 flex-1">
          <span
            className="block font-serif text-ink"
            style={{
              fontSize: 17,
              letterSpacing: -0.3,
              fontWeight: 500,
            }}
          >
            {label}
          </span>
          <span
            className="mt-0.5 block text-ink2"
            style={{ fontSize: 12, lineHeight: "16px" }}
          >
            Redeem at pickup — any size, any flavor.
          </span>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-ink px-3 py-2">
          <span className="text-cream" style={{ fontSize: 12, fontWeight: 600 }}>
            Use
          </span>
          <ChevronRight size={12} className="text-cream" />
        </span>
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/components/account/PromotionsCard.tsx
git commit -m "feat(account): add peach→cream PromotionsCard for rewards ready"
```

---

## Task 14: OrderRow (reusable row for history lists)

**Files:**
- Create: `src/components/account/OrderRow.tsx`

- [ ] **Step 1: Create component**

```tsx
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatPrice } from "@/lib/utils";

export type OrderHistoryItem = {
  id: string;
  createdAt: string | null;
  state: string | null;
  fulfillmentState: string | null;
  totalCents: string;
  itemSummary: string;
  lineCount: number;
};

export function OrderRow({ order }: { order: OrderHistoryItem }) {
  const stateKey = effectiveState(order.state, order.fulfillmentState);
  const badge = STATE_STYLES[stateKey];

  return (
    <Link
      href={`/order-confirmation/${order.id}`}
      className="flex items-center justify-between gap-3 rounded-card border border-line bg-paper p-4 transition active:opacity-90"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="uppercase tracking-wide text-ink3"
            style={{ fontSize: 12 }}
          >
            {formatDate(order.createdAt)}
          </span>
          {badge && (
            <span
              className={
                "rounded-full border px-2 py-0.5 uppercase " + badge.className
              }
              style={{ fontSize: 10, letterSpacing: 0.5, fontWeight: 600 }}
            >
              {badge.label}
            </span>
          )}
        </div>
        <h3
          className="mt-1 truncate font-serif text-ink"
          style={{ fontSize: 15, letterSpacing: -0.2, fontWeight: 500 }}
        >
          {order.itemSummary ||
            `${order.lineCount} item${order.lineCount !== 1 ? "s" : ""}`}
        </h3>
        <p className="mt-0.5 text-ink3" style={{ fontSize: 12 }}>
          {order.lineCount} item{order.lineCount !== 1 ? "s" : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className="font-mono text-ink"
          style={{ fontSize: 14, fontWeight: 700 }}
        >
          {formatPrice(BigInt(order.totalCents))}
        </span>
        <ChevronRight size={16} className="text-ink3" />
      </div>
    </Link>
  );
}

function effectiveState(
  state: string | null,
  fulfillmentState: string | null,
): string {
  if (state === "OPEN" && fulfillmentState === "PREPARED") return "READY";
  return state ?? "";
}

const STATE_STYLES: Record<string, { label: string; className: string }> = {
  OPEN: {
    label: "In Progress",
    className: "bg-peach/20 text-ink2 border-peach/40",
  },
  READY: {
    label: "Ready",
    className: "bg-green/10 text-green-dark border-green/30",
  },
  COMPLETED: {
    label: "Completed",
    className: "bg-line text-ink3 border-line",
  },
  CANCELED: {
    label: "Cancelled",
    className: "bg-red-50 text-red-700 border-red-200",
  },
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-AU", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/components/account/OrderRow.tsx
git commit -m "feat(account): add OrderRow with state badges on token palette"
```

---

## Task 15: OrderHistory section component

**Files:**
- Create: `src/components/account/OrderHistory.tsx`

- [ ] **Step 1: Create component**

```tsx
import { OrderRow, type OrderHistoryItem } from "./OrderRow";

type OrderHistoryProps = {
  orders: OrderHistoryItem[];
  title: string;
  hideIfEmpty?: boolean;
  onSeeAll?: () => void;
};

export function OrderHistory({
  orders,
  title,
  hideIfEmpty,
  onSeeAll,
}: OrderHistoryProps) {
  if (hideIfEmpty && orders.length === 0) return null;

  return (
    <section className="px-4 mt-5">
      <div className="flex items-center justify-between">
        <h2
          className="font-serif text-ink"
          style={{ fontSize: 17, letterSpacing: -0.3, fontWeight: 500 }}
        >
          {title}
        </h2>
        {onSeeAll && (
          <button
            type="button"
            onClick={onSeeAll}
            className="text-brand transition active:opacity-70"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            See all →
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {orders.length === 0 ? (
          <p className="text-ink3" style={{ fontSize: 13 }}>
            No orders yet.
          </p>
        ) : (
          orders.map((order) => <OrderRow key={order.id} order={order} />)
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/components/account/OrderHistory.tsx
git commit -m "feat(account): add OrderHistory section with optional See-all"
```

---

## Task 16: useLoyaltyEvents hook

**Files:**
- Create: `src/hooks/use-loyalty-events.ts`

- [ ] **Step 1: Create hook**

```ts
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";

export type LoyaltyEvent = {
  id: string;
  type: string;
  createdAt: string | null;
  accumulatePoints?: { points: number; orderId?: string };
  redeemReward?: { rewardId?: string };
};

export function useLoyaltyEvents(): {
  events: LoyaltyEvent[];
  loading: boolean;
} {
  const { profile } = useAuth();
  const [events, setEvents] = useState<LoyaltyEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!profile) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch("/api/loyalty/events", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.ok) setEvents(json.events ?? []);
      })
      .catch(() => {
        // Non-fatal
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.user_id]);

  return { events, loading };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/hooks/use-loyalty-events.ts
git commit -m "feat(loyalty): add useLoyaltyEvents client hook"
```

---

## Task 17: ActivityHistory

**Files:**
- Create: `src/components/account/ActivityHistory.tsx`

- [ ] **Step 1: Create component**

```tsx
"use client";

import { Gift, Star } from "lucide-react";
import { useLoyaltyEvents } from "@/hooks/use-loyalty-events";
import type { LoyaltyEvent } from "@/hooks/use-loyalty-events";

export function ActivityHistory() {
  const { events, loading } = useLoyaltyEvents();

  return (
    <section className="px-4 mt-5">
      <h2
        className="font-serif text-ink"
        style={{ fontSize: 17, letterSpacing: -0.3, fontWeight: 500 }}
      >
        Activity
      </h2>
      <div className="mt-2 flex flex-col">
        {loading && events.length === 0 ? (
          <p className="text-ink3" style={{ fontSize: 13 }}>
            Loading…
          </p>
        ) : events.length === 0 ? (
          <p className="text-ink3" style={{ fontSize: 13 }}>
            No activity yet.
          </p>
        ) : (
          events.map((event, i) => (
            <EventRow
              key={event.id}
              event={event}
              isLast={i === events.length - 1}
            />
          ))
        )}
      </div>
    </section>
  );
}

function EventRow({ event, isLast }: { event: LoyaltyEvent; isLast: boolean }) {
  const isAccrue = event.type === "ACCUMULATE_POINTS";
  const isRedeem = event.type === "REDEEM_REWARD";
  const label = isAccrue
    ? `Earned ${event.accumulatePoints?.points ?? 1} star${
        (event.accumulatePoints?.points ?? 1) === 1 ? "" : "s"
      }`
    : isRedeem
      ? "Redeemed free drink"
      : humanizeEventType(event.type);
  const Icon = isRedeem ? Gift : Star;
  const iconClass = isRedeem ? "text-ink2" : "text-star";

  return (
    <div
      className={
        "flex items-center gap-3 py-2 " +
        (isLast ? "" : "border-b border-line")
      }
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cream">
        <Icon
          size={16}
          className={iconClass}
          fill={isAccrue ? "currentColor" : "none"}
        />
      </div>
      <div className="min-w-0 flex-1">
        <span className="block text-ink" style={{ fontSize: 13 }}>
          {label}
        </span>
        <span className="mt-0.5 block text-ink3" style={{ fontSize: 11 }}>
          {formatRelative(event.createdAt)}
        </span>
      </div>
    </div>
  );
}

function humanizeEventType(type: string): string {
  return type
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays < 0) return d.toLocaleDateString("en-AU");
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Intl.DateTimeFormat("en-AU", {
    month: "short",
    day: "numeric",
  }).format(d);
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/components/account/ActivityHistory.tsx
git commit -m "feat(account): add ActivityHistory (loyalty events feed)"
```

---

## Task 18: StoreInfo

**Files:**
- Create: `src/components/account/StoreInfo.tsx`

- [ ] **Step 1: Create component**

```tsx
import { Clock, MapPin, Phone } from "lucide-react";
import { BUSINESS } from "@/lib/constants";

export function StoreInfo() {
  return (
    <section className="px-4 mt-5">
      <h2
        className="font-serif text-ink"
        style={{ fontSize: 17, letterSpacing: -0.3, fontWeight: 500 }}
      >
        Store
      </h2>
      <div className="mt-2 flex flex-col gap-2 rounded-card border border-line bg-paper p-4">
        <div className="flex items-start gap-3">
          <MapPin size={16} className="text-ink2 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <span
              className="block text-ink"
              style={{ fontSize: 13, fontWeight: 500 }}
            >
              {BUSINESS.name}
            </span>
            <span
              className="block text-ink2"
              style={{ fontSize: 13, lineHeight: "18px" }}
            >
              {BUSINESS.address}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Phone size={16} className="text-ink2 shrink-0" />
          <a
            href={`tel:+61${BUSINESS.phone.replace(/\D/g, "").replace(/^0/, "")}`}
            className="font-mono text-brand"
            style={{ fontSize: 13, fontWeight: 700 }}
          >
            {BUSINESS.phone}
          </a>
        </div>
        <div className="flex items-start gap-3">
          <Clock size={16} className="text-ink2 mt-0.5 shrink-0" />
          <span
            className="text-ink2"
            style={{ fontSize: 13, lineHeight: "18px" }}
          >
            Mon–Sun · 10:00 am – 10:30 pm
          </span>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/components/account/StoreInfo.tsx
git commit -m "feat(account): add StoreInfo card (address/phone/hours)"
```

---

## Task 19: LegalFooter

**Files:**
- Create: `src/components/account/LegalFooter.tsx`

- [ ] **Step 1: Create component**

```tsx
import Link from "next/link";

export function LegalFooter() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";

  return (
    <footer className="px-4 mt-5">
      <div
        className="flex items-center justify-center gap-3 text-ink3"
        style={{ fontSize: 12 }}
      >
        <Link
          href="/privacy"
          className="transition hover:text-ink2"
        >
          Privacy
        </Link>
        <span>·</span>
        <Link
          href="/terms"
          className="transition hover:text-ink2"
        >
          Terms
        </Link>
        <span>·</span>
        <span className="font-mono" style={{ fontWeight: 700 }}>
          v{version}
        </span>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/components/account/LegalFooter.tsx
git commit -m "feat(account): add LegalFooter with privacy/terms/version"
```

---

## Task 20: SignOutBtn

**Files:**
- Create: `src/components/account/SignOutBtn.tsx`

- [ ] **Step 1: Create component**

```tsx
"use client";

type SignOutBtnProps = {
  onSignOut: () => void | Promise<void>;
};

export function SignOutBtn({ onSignOut }: SignOutBtnProps) {
  return (
    <div className="px-4 mt-5">
      <button
        type="button"
        onClick={onSignOut}
        className="w-full rounded-card border border-line bg-paper py-3 text-ink transition active:bg-cream"
        style={{ fontSize: 14, fontWeight: 500 }}
      >
        Sign out
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/components/account/SignOutBtn.tsx
git commit -m "feat(account): add SignOutBtn full-width paper pill"
```

---

## Task 21: Add `deleteAccount` to AuthProvider

**Files:**
- Modify: `src/components/auth/AuthProvider.tsx`

- [ ] **Step 1: Extend context**

In `AuthContextValue` type (around line 62), add `deleteAccount` field:

```ts
type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: AuthProfile | null;
  loyalty: LoyaltyInfo | null;
  welcomeDiscount: WelcomeDiscountInfo;
  starsPerReward: number;
  loading: boolean;
  signInWithApple: (redirectTo?: string) => Promise<void>;
  signInWithGoogle: (redirectTo?: string) => Promise<void>;
  signInWithPhone: (phoneE164: string) => Promise<void>;
  verifyOtp: (phoneE164: string, token: string) => Promise<void>;
  completeSignup: (args: {
    firstName: string;
    lastName?: string;
  }) => Promise<AuthProfile>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  refresh: () => Promise<void>;
};
```

- [ ] **Step 2: Implement `deleteAccount` callback**

Before the `value` `useMemo` (around line 315, after `signOut` callback), add:

```ts
const deleteAccount = useCallback(async () => {
  const res = await fetch("/api/account/delete", { method: "POST" });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `delete failed: ${res.status}`);
  }
  await supabase.auth.signOut();
  setProfile(null);
  setLoyalty(null);
  setWelcomeDiscount(DEFAULT_WELCOME);
}, [supabase]);
```

- [ ] **Step 3: Wire into `value`**

Update the `useMemo` return (around line 322) to include `deleteAccount` alongside `signOut`:

```ts
const value = useMemo<AuthContextValue>(
  () => ({
    session,
    user: session?.user ?? null,
    profile,
    loyalty,
    welcomeDiscount,
    starsPerReward,
    loading,
    signInWithApple,
    signInWithGoogle,
    signInWithPhone,
    verifyOtp,
    completeSignup,
    signOut,
    deleteAccount,
    refresh: fetchMe,
  }),
  [
    session,
    profile,
    loyalty,
    welcomeDiscount,
    starsPerReward,
    loading,
    signInWithApple,
    signInWithGoogle,
    signInWithPhone,
    verifyOtp,
    completeSignup,
    signOut,
    deleteAccount,
    fetchMe,
  ],
);
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/components/auth/AuthProvider.tsx
git commit -m "feat(auth): expose deleteAccount() for web UI"
```

---

## Task 22: DeleteAccountBtn

**Files:**
- Create: `src/components/account/DeleteAccountBtn.tsx`

- [ ] **Step 1: Create component**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/components/auth/AuthProvider";

export function DeleteAccountBtn() {
  const router = useRouter();
  const { deleteAccount } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setPending(true);
    setError(null);
    try {
      await deleteAccount();
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }

  return (
    <div className="px-4 mt-3 mb-6 flex flex-col items-center gap-1">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            className="text-red-600 underline transition active:opacity-70"
            style={{ fontSize: 12 }}
          >
            Delete account
          </button>
        </AlertDialogTrigger>
        <AlertDialogPortal>
          <AlertDialogOverlay className="mbt-dialog-overlay fixed inset-0 z-50 bg-black/55" />
          <AlertDialogContent className="mbt-dialog-content fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-white p-5 shadow-primary-cta">
            <AlertDialogHeader>
              <AlertDialogTitle
                className="font-serif text-ink"
                style={{ fontSize: 17, letterSpacing: -0.3, fontWeight: 500 }}
              >
                Delete account?
              </AlertDialogTitle>
              <AlertDialogDescription
                className="mt-2 text-ink2"
                style={{ fontSize: 13, lineHeight: "18px" }}
              >
                This will permanently remove your account, loyalty stars, and
                order history. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error && (
              <p
                className="mt-2 text-red-600"
                style={{ fontSize: 12 }}
              >
                {error}
              </p>
            )}
            <AlertDialogFooter className="mt-4 flex justify-end gap-2">
              <AlertDialogCancel
                className="rounded-full border border-line bg-paper px-4 py-2 text-ink transition active:bg-cream"
                style={{ fontSize: 13, fontWeight: 500 }}
                disabled={pending}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={onConfirm}
                className="rounded-full bg-red-600 px-4 py-2 text-white transition active:opacity-85 disabled:opacity-60"
                style={{ fontSize: 13, fontWeight: 600 }}
                disabled={pending}
              >
                {pending ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogPortal>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 2: Verify existing `alert-dialog` primitives export the symbols used above**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
grep -E "AlertDialog(Overlay|Portal|Action|Cancel|Trigger|Content|Header|Footer|Title|Description)?" src/components/ui/alert-dialog.tsx | head -20
```
Expected: matches listing each symbol. If `AlertDialogPortal` or `AlertDialogOverlay` is not exported, open `src/components/ui/alert-dialog.tsx` and add passthrough re-exports from `@radix-ui/react-alert-dialog` (both primitives exist upstream):

```ts
export const AlertDialogPortal = AlertDialogPrimitive.Portal;
export const AlertDialogOverlay = AlertDialogPrimitive.Overlay;
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/components/account/DeleteAccountBtn.tsx src/components/ui/alert-dialog.tsx
git commit -m "feat(account): add DeleteAccountBtn with alert-dialog confirm"
```

---

## Task 23: Rewrite `/account` page to wire everything

**Files:**
- Modify: `src/app/account/page.tsx` (full rewrite)

- [ ] **Step 1: Replace contents**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { SignInCard } from "@/components/auth/SignInCard";
import { useAuth } from "@/components/auth/AuthProvider";
import { AccountHeader } from "@/components/account/AccountHeader";
import { LoyaltyCard } from "@/components/account/LoyaltyCard";
import { MiniStats } from "@/components/account/MiniStats";
import { AddToWalletButton } from "@/components/account/AddToWalletButton";
import { WelcomeDiscountCard } from "@/components/account/WelcomeDiscountCard";
import { PromotionsCard } from "@/components/account/PromotionsCard";
import { OrderHistory } from "@/components/account/OrderHistory";
import { ActivityHistory } from "@/components/account/ActivityHistory";
import { StoreInfo } from "@/components/account/StoreInfo";
import { LegalFooter } from "@/components/account/LegalFooter";
import { SignOutBtn } from "@/components/account/SignOutBtn";
import { DeleteAccountBtn } from "@/components/account/DeleteAccountBtn";
import type { OrderHistoryItem } from "@/components/account/OrderRow";

// QR card uses `document` at module scope via qrcode.react — keep it
// client-only to avoid SSR mismatch (same pattern as before the rewrite).
const MemberQrCard = dynamic(
  () =>
    import("@/components/account/MemberQrCard").then((m) => m.MemberQrCard),
  { ssr: false },
);

export default function AccountPage() {
  const { profile, loyalty, starsPerReward, signOut, refresh, loading } =
    useAuth();
  const router = useRouter();

  const [orders, setOrders] = useState<OrderHistoryItem[]>([]);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) {
      setOrders([]);
      return;
    }
    let cancelled = false;
    fetch("/api/orders/history", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setOrdersError(json.error ?? "Failed to load orders");
          return;
        }
        setOrders(json.orders ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setOrdersError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.user_id]);

  const { activeOrders, pastOrders } = useMemo(() => {
    const active = orders.filter((o) => o.state === "OPEN");
    const past = orders.filter((o) => o.state !== "OPEN");
    return { activeOrders: active, pastOrders: past };
  }, [orders]);

  const balance = loyalty?.balance ?? 0;
  const lifetime = loyalty?.lifetimePoints ?? balance;
  const goal = starsPerReward > 0 ? starsPerReward : 9;
  const rewardsAvailable = Math.floor(balance / goal);
  const currentStars = balance % goal;

  return (
    <main className="mx-auto w-full max-w-md flex-1 pt-10 pb-24">
      {loading ? (
        <LoadingSpinner />
      ) : !profile ? (
        <div className="px-4 pt-10">
          <SignInCard onComplete={refresh} />
        </div>
      ) : (
        <>
          {ordersError && (
            <p
              className="mx-4 mt-3 rounded-tile border border-red-200 bg-red-50 p-3 text-red-700"
              style={{ fontSize: 13 }}
            >
              {ordersError}
            </p>
          )}
          <AccountHeader profile={profile} />
          <WelcomeDiscountCard />
          <LoyaltyCard balance={balance} starsPerReward={goal} />
          <MiniStats
            drinks={lifetime}
            rewards={rewardsAvailable}
            stars={currentStars}
            onPressRewards={() => router.push("/account/promotions")}
          />
          <MemberQrCard
            customerId={profile.square_customer_id}
            phoneE164={profile.phone_e164}
          />
          <AddToWalletButton />
          <PromotionsCard rewardsCount={rewardsAvailable} />
          {orders.length === 0 ? (
            <OrderHistory orders={[]} title="Orders" />
          ) : (
            <>
              <OrderHistory
                orders={activeOrders}
                title="In Progress"
                hideIfEmpty
              />
              <OrderHistory
                orders={pastOrders.slice(0, 3)}
                title="Past Orders"
                hideIfEmpty
                onSeeAll={
                  pastOrders.length > 3
                    ? () => router.push("/account/orders")
                    : undefined
                }
              />
            </>
          )}
          <ActivityHistory />
          <StoreInfo />
          <LegalFooter />
          <SignOutBtn onSignOut={signOut} />
          <DeleteAccountBtn />
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/app/account/page.tsx
git commit -m "feat(account): rewrite page to single-column RN-aligned layout"
```

---

## Task 24: `/account/orders` — Past Orders "See all" route

**Files:**
- Create: `src/app/account/orders/page.tsx`

- [ ] **Step 1: Create page**

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";
import { SignInCard } from "@/components/auth/SignInCard";
import { useAuth } from "@/components/auth/AuthProvider";
import { OrderHistory } from "@/components/account/OrderHistory";
import type { OrderHistoryItem } from "@/components/account/OrderRow";

export default function AccountOrdersPage() {
  const { profile, loading, refresh } = useAuth();
  const [orders, setOrders] = useState<OrderHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) {
      setOrders([]);
      return;
    }
    let cancelled = false;
    fetch("/api/orders/history", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setError(json.error ?? "Failed to load orders");
          return;
        }
        setOrders(json.orders ?? []);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.user_id]);

  const pastOrders = orders.filter((o) => o.state !== "OPEN");

  return (
    <main className="mx-auto w-full max-w-md flex-1 pt-10 pb-24">
      {loading ? (
        <LoadingSpinner />
      ) : !profile ? (
        <div className="px-4 pt-10">
          <SignInCard onComplete={refresh} />
        </div>
      ) : (
        <>
          <div className="px-4 pt-2 pb-3">
            <Link
              href="/account"
              className="inline-flex items-center gap-1 text-ink2 transition active:opacity-70"
              style={{ fontSize: 13 }}
            >
              <ArrowLeft size={14} />
              Account
            </Link>
          </div>
          {error && (
            <p
              className="mx-4 mt-1 rounded-tile border border-red-200 bg-red-50 p-3 text-red-700"
              style={{ fontSize: 13 }}
            >
              {error}
            </p>
          )}
          <OrderHistory orders={pastOrders} title="Past Orders" />
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add src/app/account/orders/page.tsx
git commit -m "feat(account): add /account/orders route for Past Orders See-all"
```

---

## Task 25: Visual verification via cmux browser

**Files:** none (verification only)

- [ ] **Step 1: Confirm dev server running on :3000**

```bash
lsof -ti:3000
```
If empty: `cd /Users/stanyan/Github/mandys_bubble_tea && npm run dev` via `run_in_background`. Wait 10s. Then re-run `lsof -ti:3000` — expect a PID.

- [ ] **Step 2: Open/reuse cmux browser pane**

```bash
cmux list-panes
```
If no pane with `:3000` URL exists:
```bash
cmux new-pane --type browser --direction right --url http://localhost:3000/account
```
Else:
```bash
cmux browser goto http://localhost:3000/account
```

- [ ] **Step 3: Capture signed-in account page screenshot**

Sign in via the UI if not already, then:
```bash
cmux browser reload
cmux browser screenshot --out /tmp/cmux-account.png
```

Read `/tmp/cmux-account.png` (via the Read tool) and diff visually against the reference Image #27. Checklist:
- ✅ Peach→brown gradient circular avatar with initials
- ✅ Name Fraunces 22px + phone JetBrainsMono 12px
- ✅ Brown gradient LoyaltyCard with peach dot + "MANDY'S REWARDS" eyebrow + balance/goal + Member pill
- ✅ Nine cup-row icons (current count filled peach, rest outlined)
- ✅ Inline Redeem/View pill at bottom-right of loyalty card
- ✅ Three MiniStats tiles — serif number + mono uppercase label
- ✅ MemberQrCard row — QR + eyebrow + "Scan at the counter" + memberId + Expand pill
- ✅ Save-card row with CreditCard icon + Apple CTA pill
- ✅ Peach→cream PromotionsCard (only if rewards available)
- ✅ OrderHistory rows on paper cards
- ✅ ActivityHistory list
- ✅ StoreInfo card
- ✅ LegalFooter Privacy · Terms · v{version}
- ✅ Full-width SignOutBtn
- ✅ Small underlined red "Delete account" centered at bottom

- [ ] **Step 4: Expand modal smoke test**

```bash
cmux browser click --selector "button[aria-label='Expand member QR']"
cmux browser screenshot --out /tmp/cmux-account-qr-modal.png
cmux browser click --selector "[role='dialog']"
```
Read `/tmp/cmux-account-qr-modal.png` — expect 260 px QR on white card, Close button visible.

- [ ] **Step 5: Runtime errors check**

```bash
cmux browser errors list
cmux browser console list
```
Expected: empty (or only benign noise). If real errors, fix before moving on.

- [ ] **Step 6: Cross-page visual regression**

Run through these pages and screenshot each:
```bash
cmux browser goto http://localhost:3000/ && cmux browser screenshot --out /tmp/cmux-home.png
cmux browser goto http://localhost:3000/menu && cmux browser screenshot --out /tmp/cmux-menu.png
cmux browser goto http://localhost:3000/cart && cmux browser screenshot --out /tmp/cmux-cart.png
cmux browser goto http://localhost:3000/checkout && cmux browser screenshot --out /tmp/cmux-checkout.png
```
Read each. Verify no hardcoded red `#C43A10` is peeking through (would look out-of-place on the beige background). Verify Inter replaces Arial — body text should look lighter, narrower.

- [ ] **Step 7: Mobile viewport sanity**

In cmux browser, set viewport to 390×844 (mobile):
```bash
cmux browser set-viewport --width 390 --height 844
cmux browser goto http://localhost:3000/account
cmux browser screenshot --out /tmp/cmux-account-390.png
```
Read. Expect the same single-column layout fitting the narrow viewport edge-to-edge.

- [ ] **Step 8: Document findings**

If any checklist item fails, note it in a scratch doc or commit message. Fix obvious issues inline (wrong Tailwind class, missing import). For anything ambiguous, surface to the user before proceeding.

No commit at this step — verification only.

---

## Task 26: Update QUEUE + HANDOFF + push

**Files:**
- Modify: `~/system/DEV_QUEUE.md`
- Modify: `~/system/DEV_HANDOFF.md`

- [ ] **Step 1: Push all commits**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git push origin main
```
Expected: `main -> main` with the 20+ commits from this plan.

- [ ] **Step 2: Update DEV_QUEUE.md**

Under "Mandy's Bubble Tea" section, add a new `Recently Completed` entry at the top summarizing this session (1-2 bullets; honor the existing style). Remove any task lines this plan completes.

- [ ] **Step 3: Update DEV_HANDOFF.md**

Write a fresh handoff for `2026-04-23 (Account page RN alignment)` covering:
- Commit range pushed (`<first>..<last>`)
- What was done (brand color + bg + fonts + 12 components + 2 new routes)
- What's queued next (cross-page visual polish for home/menu/cart/checkout/order-confirmation — their colors now follow the new tokens but layouts are untouched)
- Any issues surfaced during Task 25 that need follow-up

- [ ] **Step 4: No commit on system files (they live in `~/system/`, not in repo)**

---

## Self-Review (run before handing off)

### Spec Coverage
| Spec requirement | Task |
|---|---|
| `src/lib/theme.ts` raw tokens | DROPPED — Tailwind v4 @theme in globals.css exposes tokens directly; components use `bg-brand` etc. No need for TS constant file |
| Tailwind config extend | Task 2 (via `@theme inline` in `globals.css` per Tailwind v4 convention) |
| Fraunces + Inter + JetBrains Mono via next/font/google | Task 3 |
| `<body>` bg #F2E8DF | Tasks 2 + 3 (CSS var + body class) |
| `BRAND.primaryColor` swap | Task 4 |
| 12 account sub-components | Tasks 7-20, 22 |
| `max-w-md` single-column page | Task 23 |
| `/account/orders` See-all route | Task 24 |
| `/api/loyalty/events` usage | Task 16 (hook) + Task 17 (component) |
| `/api/account/delete` usage | Task 21 (AuthProvider) + Task 22 (UI) |
| Visual verification | Task 25 |
| Cross-page regression | Task 25 Step 6 |
| QUEUE + HANDOFF update | Task 26 |

### Placeholder scan
- No "TBD" / "fill in" / "similar to…" — checked.
- Every step has either exact code or exact command.
- No "add appropriate error handling" — where needed, explicit catch blocks written (Task 16 `catch`, Task 22 `catch(err) setError`).

### Type consistency
- `OrderHistoryItem` defined once in Task 14 (`OrderRow.tsx`), re-exported and imported by Tasks 15, 23, 24.
- `LoyaltyEvent` defined in Task 16, imported by Task 17.
- `AuthProfile` uses the existing type from `AuthProvider.tsx` (no redefinition).
- `deleteAccount` signature `() => Promise<void>` consistent between Tasks 21 and 22.
- `onSignOut` prop name on `SignOutBtn` used both in Task 20 definition and Task 23 usage.
- `onPressRewards` prop name on `MiniStats` used both in Task 9 definition and Task 23 usage.

---

## Execution Choice

**Plan complete and saved to `docs/superpowers/plans/2026-04-23-account-page-rn-alignment.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task. Two-stage review between tasks. Fast iteration, clean context per task.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`. Batched execution with human checkpoints.

**Which approach?**
