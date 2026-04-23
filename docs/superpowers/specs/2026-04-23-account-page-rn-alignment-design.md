# Account Page — RN App Visual Alignment

**Date:** 2026-04-23
**Scope:** Align the web account page (`/account`) 1:1 with the RN app's account screen. Ship token infrastructure, Google Fonts, global brand + body-bg swap, and all 12 account sub-components. Do NOT rework other pages' layouts in this pass; only the brand color / bg / fonts will propagate to them automatically.

---

## Goal

Turn the web account page into a "web version of the app" — single-column, mobile-viewport-wide (`max-w-md`), centered on desktop — visually identical to the RN reference shown in the user's screenshot (2026-04-23): brown gradient loyalty card, peach avatar, mini stats, member QR, Apple Wallet, orange "free drinks ready" promotion card, order history, activity, store info, legal, sign-out, delete account.

## Non-Goals

- Reworking layouts of other pages (home, menu, cart, checkout, order-confirmation, promotions, order-detail, etc.). Those only inherit the new `BRAND.primaryColor` (#8D5524) + `<body>` bg (#F2E8DF) + Inter/Fraunces/Mono font stack; their component structures stay as-is.
- Rewriting the global `<Footer>` component. `LegalFooter` lives inside the account page only.
- Migrating cart / menu / checkout `<Link>` CTAs off `BRAND.primaryColor` — they follow the constant.
- Dark mode.

## Design Decisions (locked)

1. **Scope**: Full RN alignment on account page, all 12 sub-components (6 reworked, 6 new).
2. **Brand color**: Global switch. `BRAND.primaryColor` `#C43A10` → `#8D5524`. Body bg → `#F2E8DF`. Other pages visually shift brown; their component structures untouched this pass.
3. **Fonts**: Three Google Fonts via `next/font/google` — Fraunces (serif), Inter (sans, body default), JetBrains Mono (mono). Injected as CSS vars, mapped to Tailwind `font-serif / font-sans / font-mono`.
4. **Width**: `max-w-md` (448 px) single column, centered. Large viewports show wide whitespace on both sides — "web viewport of the app."
5. **Component coverage**: All 12 RN account sub-components ported — AccountHeader, LoyaltyCard, MiniStats, MemberQrCard, AddToWalletButton, WelcomeDiscountCard, PromotionsCard, OrderHistory, ActivityHistory, StoreInfo, LegalFooter, SignOutBtn, DeleteAccountBtn.

---

## Architecture

### 1. Token Infrastructure — `src/lib/theme.ts` (NEW)

Mirror `mandys_bubble_tea_app/constants/theme.ts`:

```ts
export const T = {
  bg:        '#F2E8DF',
  bg2:       '#E8DAC6',
  paper:     '#FFF9F0',
  card:      '#FFFFFF',
  ink:       '#2A1E14',
  ink2:      '#5A4330',
  ink3:      'rgba(42,30,20,0.55)',
  ink4:      'rgba(42,30,20,0.28)',
  line:      'rgba(42,30,20,0.10)',
  brand:     '#8D5524',
  brandDark: '#6B3E15',
  sage:      '#A2AD91',
  peach:     '#FFB380',
  cream:     '#FFF3DE',
  star:      '#F2B64A',
  green:     '#3CA96E',
  greenDark: '#2E7F52',
} as const

export const RADIUS = { pill: 9999, card: 20, tile: 12, small: 10 } as const
export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const
```

### 2. Tailwind config — `tailwind.config.ts`

Wire the same tokens into Tailwind:

```ts
theme.extend = {
  colors: {
    bg: '#F2E8DF', bg2: '#E8DAC6', paper: '#FFF9F0',
    ink: '#2A1E14', ink2: '#5A4330', ink3: 'rgba(42,30,20,0.55)',
    line: 'rgba(42,30,20,0.10)',
    brand: '#8D5524', brandDark: '#6B3E15',
    peach: '#FFB380', cream: '#FFF3DE', star: '#F2B64A',
  },
  borderRadius: { card: '20px', tile: '12px', small: '10px' },
  boxShadow: {
    card: '0 2px 8px rgba(42,30,20,0.04)',
    miniCart: '0 10px 20px rgba(107,62,21,0.55)',
    primaryCta: '0 14px 24px rgba(42,30,20,0.55)',
  },
  fontFamily: {
    serif: ['var(--font-fraunces)', 'Georgia', 'serif'],
    sans:  ['var(--font-inter)', 'system-ui', 'sans-serif'],
    mono:  ['var(--font-mono)', 'ui-monospace', 'monospace'],
  },
}
```

### 3. Fonts — `src/app/layout.tsx`

```ts
import { Fraunces, Inter, JetBrains_Mono } from 'next/font/google'
const fraunces = Fraunces({ weight:['500','600'], subsets:['latin'], variable:'--font-fraunces', display:'swap' })
const inter    = Inter({ weight:['400','500','600'], subsets:['latin'], variable:'--font-inter', display:'swap' })
const mono     = JetBrains_Mono({ weight:['700'], subsets:['latin'], variable:'--font-mono', display:'swap' })

<html lang="en" className={`${fraunces.variable} ${inter.variable} ${mono.variable}`}>
  <body className="bg-bg text-ink font-sans">…</body>
</html>
```

### 4. Brand constant — `src/lib/constants.ts`

```diff
-  primaryColor: '#C43A10',
+  primaryColor: '#8D5524',
```

Accept cascade effect: every page that reads `BRAND.primaryColor` auto-switches. Verify visually (see "Verification" below). No accent color change (`#F5E6C8` cream is close to `T.cream #FFF3DE` — leave as-is; revisit if tension appears).

---

## Page Layout — `src/app/account/page.tsx`

Replace the signed-in `AccountDashboard` JSX with:

```tsx
<main className="mx-auto w-full max-w-md pt-10 pb-24">
  <AccountHeader profile={profile} />
  {welcomeDiscount.available && <WelcomeDiscountCard />}
  <LoyaltyCard balance={balance} starsPerReward={starsPerReward} />
  <MiniStats
    drinks={lifetimePoints}
    rewards={rewardsAvailable}
    stars={currentStars}
    onPressRewards={() => router.push('/account/promotions')}
  />
  <MemberQrCard customerId={profile.square_customer_id} phoneE164={profile.phone_e164} />
  <AddToWalletButton />
  {rewardsAvailable > 0 && <PromotionsCard rewardsCount={rewardsAvailable} />}
  {orders.length === 0 ? (
    <OrderHistory orders={[]} title="Orders" />
  ) : (
    <>
      <OrderHistory orders={activeOrders} title="In Progress" hideIfEmpty />
      <OrderHistory
        orders={pastOrders.slice(0, 3)}
        title="Past Orders"
        hideIfEmpty
        onSeeAll={pastOrders.length > 3 ? () => router.push('/account/orders') : undefined}
      />
    </>
  )}
  <ActivityHistory events={events} />
  <StoreInfo />
  <LegalFooter />
  <SignOutBtn onClick={signOut} />
  <DeleteAccountBtn onConfirm={deleteAccount} />
</main>
```

Each component owns its own `px-4 mt-3` (horizontal + top gap matching RN SPACING.lg / md). Page layer stays minimal.

New route **`/account/orders`** for "Past Orders → See all" — renders all past orders in the same `max-w-md` single-column style. Implementation: reuse `OrderHistory` with `orders={pastOrders}` and no limit.

---

## Component Specs

All components live in `src/components/account/*.tsx`. Tailwind classes below map directly to RN equivalents; pixel values come from `theme.ts` tokens.

### AccountHeader (rewrite)
```
div flex items-center gap-3.5 px-4 pt-2 pb-3
├─ div 56×56 rounded-full bg-gradient-to-br from-peach to-brand
│     shadow-[0_6px_14px_rgba(141,85,36,0.45)] flex-center
│     span font-serif text-[22px] tracking-[-0.5px] text-white → initials
└─ div flex-1 min-w-0
      h1 font-serif text-[22px] tracking-[-0.5px] text-ink truncate → fullName
      p  font-mono text-[12px] text-ink3 mt-0.5 → formatPhone(phone_e164)
```
`formatPhone` mirrors RN: `+61405155473` → `0405 155 473`.

### LoyaltyCard (rewrite)
```
Link href="/account/promotions"
  div px-4 mt-3
    div rounded-[20px] shadow-miniCart bg-gradient-to-br from-brand to-brandDark p-[22px]
         transition-transform active:scale-[0.985]
      ├─ row flex justify-between items-start
      │    left col
      │      row gap-2 items-center: peach dot (6×6 rounded-full) + eyebrow mono 10.5px
      │        "MANDY'S REWARDS" text-white/70
      │      row mt-2 items-baseline
      │        span font-serif text-[36px] leading-[36px] tracking-[-0.8px] text-white → balance
      │        span font-serif text-[24px] text-white/45 ml-1.5 → " / {goal} stars"
      │    right pill: bg-white/15 rounded-full px-2.5 py-1.5 flex gap-1
      │      star icon peach 12px + span font-sans text-[11px] text-white "Member"
      ├─ StarCupsRow currentStars={balance % goal} total={goal} (mt-[18px])
      └─ row mt-[18px] justify-between items-center
           left p font-sans text-[13px] text-white/85 flex-1 pr-3
             reached ? "🎉 Free drink ready to redeem"
                     : "{toGo}" (bold white) + " stars until a free drink"
           right pill flex gap-1.5 items-center rounded-full px-3 py-1.5
             bg = reached ? peach : white/18
             span text-[12.5px] font-medium
               color = reached ? brandDark : white
               text = reached ? "Redeem" : "View"
             arrow-right icon same color, 12px
```

### StarCupsRow (NEW — `src/components/brand/StarCupsRow.tsx`)
9 inline SVG "cup" icons in a `flex gap-1 justify-between mt-[18px]` row. Shape: simplified bubble-tea cup SVG (24×28 viewBox), `filled` (fill=peach) vs `empty` (stroke=white/40, fill=transparent). Index < currentStars → filled. No gradient on empty state. Match RN `brand/StarCupsRow.tsx` shape — copy the path commands verbatim.

### MiniStats (NEW)
```
div flex gap-2.5 px-4 mt-3
  Tile Drinks / Tile Rewards / Tile Stars
    button flex-1 bg-paper border border-line rounded-[12px] py-3 px-2.5
           text-left active:opacity-75 active:bg-cream transition
      span block font-serif text-[22px] tracking-[-0.4px] text-ink leading-[24px] → n
      span block font-mono text-[10.5px] uppercase tracking-[1.3px] text-ink3 mt-1 → label
```
Non-pressable tiles: plain `<div>`.

### MemberQrCard (rewrite — existing uses shadcn `Dialog`)
```
div px-4 mt-3
  button bg-paper border border-line rounded-[20px] p-4 flex items-center gap-3.5 w-full
    div 96×96 bg-white rounded-[12px] border border-line p-1.5 flex-center
      QRCode (qrcode.react — already installed, verify) size=84 value={phoneE164}
    div flex-1 min-w-0 text-left
      span block font-mono text-[10.5px] tracking-[1.4px] text-brand → "MEMBER QR"
      span block font-serif text-[17px] tracking-[-0.3px] text-ink leading-5 mt-1 → "Scan at the counter"
      span block font-mono text-[11.5px] text-ink3 mt-1 → memberId (M-{last8.toUpperCase()})
      span mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-ink
        text font-sans text-[11.5px] text-cream → "Expand"
        chev-right icon cream 10px
  Dialog (shadcn) on click
    content bg-white rounded-[20px] p-6 flex-col items-center gap-3
      QRCode size=260 value={phoneE164}
      span font-mono text-[14px] tracking-[1.5px] text-ink → memberId
      button bg-ink text-cream rounded-full px-5 py-2.5 font-sans text-[13px] → "Close"
```

### AddToWalletButton (rewrite external chrome; keep logic)
Keep Safari/iOS detection + `/api/wallet/pass/exchange` flow. Swap external JSX to:
```
div mx-4 mt-3 bg-paper rounded-[20px] shadow-card p-3 flex items-center gap-3
  div 44×44 bg-bg rounded-[12px] flex-center
    credit-card icon text-ink2 size-5
  div flex-1 min-w-0
    span block font-serif text-[17px] tracking-[-0.3px] text-ink → "Save your member card"
    span block font-sans text-[13px] text-ink3 mt-0.5 → subtitle (added/polling/loading/idle)
  button h-9 min-w-[90px] px-3.5 rounded-full bg-ink text-white flex-center gap-1.5
    (apple-logo inline SVG white 14px) + span font-sans text-[13px] font-medium → "Add to Wallet" / "Open"
    busy → ActivityIndicator/Spinner
```

### WelcomeDiscountCard (rewrite chrome)
Keep logic. Outer card: `bg-paper border-line rounded-[20px]`. Accent: `text-brand`. Title: `font-serif`. Body: `font-sans`.

### PromotionsCard (NEW)
```
div px-4 mt-3
  Link href="/account/promotions"
    div bg-gradient-to-br from-peach to-cream
         border border-[rgba(141,85,36,0.12)] rounded-[20px] p-4
         flex items-center gap-3
      div 44×44 rounded-[14px] bg-ink flex-center
        gift icon text-cream size-[22px]
      div flex-1
        span block font-serif text-[17px] tracking-[-0.3px] text-ink → "{N} free drink(s) ready"
        span block font-sans text-[12px] text-ink2 mt-0.5 → "Redeem at pickup — any size, any flavor."
      div px-3 py-2 rounded-full bg-ink flex items-center gap-1
        span font-sans text-[12px] font-semibold text-cream → "Use"
        chev-right icon cream 12px
```
Hidden when `rewardsCount <= 0`.

### OrderHistory (rewrite — replace `OrderHistorySections`)
Single component `{ orders, title, hideIfEmpty?, onSeeAll? }`:
- `hideIfEmpty && orders.length === 0` → return null
- Title row: `font-serif text-[17px] text-ink` + optional `onSeeAll` button `font-sans text-[13px] text-brand` "See all →"
- Rows list: `flex flex-col gap-2`, each row:
```
Link href="/order-confirmation/{id}"
  div bg-paper border-line rounded-[20px] p-4 flex justify-between items-center gap-3
    div flex-1 min-w-0
      row flex gap-2 items-center
        span font-sans text-[12px] uppercase tracking-wide text-ink3 → formatDate
        stateBadge (rounded-full px-2 py-0.5 text-[10px] font-semibold, color map below)
      h3 font-serif text-[15px] text-ink mt-1 truncate → itemSummary
      p font-sans text-[12px] text-ink3 mt-0.5 → "{lineCount} item(s)"
    div flex items-center gap-2
      span font-mono text-[14px] font-bold text-ink → formatPrice(totalCents)
      chev-right icon text-ink3 size-4
```
State badge color map (reuse existing `STATE_STYLES`, retune to token palette):
- READY → `bg-green/10 text-greenDark border-green/30`
- OPEN → `bg-peach/20 text-ink2 border-peach/40`
- COMPLETED → `bg-line text-ink3 border-line`
- CANCELED → `bg-red-50 text-red-700 border-red-200`

### ActivityHistory (NEW)
Data source: `/api/loyalty/events`. Verify route exists; if not, create thin proxy that calls `squareClient.loyalty.searchEvents({ query: { filter: { loyaltyAccountFilter: { loyaltyAccountId } } } })`, returns last ~20 events.

Component:
```
section px-4 mt-5
  h2 font-serif text-[17px] text-ink → "Activity"
  div mt-2 flex flex-col gap-1
    each event row flex gap-3 items-center py-2 border-b border-line last:border-0
      icon 32×32 bg-cream rounded-full flex-center
        accrue → star icon star-color; redeem → gift icon ink2
      div flex-1 min-w-0
        span block font-sans text-[13px] text-ink → eventLabel
          ACCRUE → "Earned {points} star"
          REDEEM_REWARD → "Redeemed free drink"
          ADJUST_POINTS → "Balance adjusted: {delta}"
        span block font-sans text-[11px] text-ink3 mt-0.5 → formatRelative(createdAt)
  (orders empty) → "No activity yet" font-sans text-[13px] text-ink3
```

`formatRelative`: today / yesterday / `{N} days ago` for < 7; otherwise `MMM D`.

### StoreInfo (NEW)
```
section px-4 mt-5
  h2 font-serif text-[17px] text-ink → "Store"
  div mt-2 bg-paper border-line rounded-[20px] p-4 flex-col gap-2
    row flex items-start gap-3
      map-pin icon text-ink2 size-4 mt-0.5
      div flex-1
        span block font-sans text-[13px] text-ink → "Mandy's Bubble Tea"
        span block font-sans text-[13px] text-ink2 → "34 Davenport St, Southport QLD 4215"
    row flex items-center gap-3
      phone icon text-ink2 size-4
      a href="tel:+61404978238" font-mono text-[13px] text-brand → "0404 978 238"
    row flex items-start gap-3
      clock icon text-ink2 size-4 mt-0.5
      div flex-1 font-sans text-[13px] text-ink2
        today/week hours (reuse lib/hours.ts if exists — else hardcode "Mon–Sun · 10:00 am – 10:30 pm")
```

### LegalFooter (NEW)
```
section px-4 mt-5
  div flex items-center justify-center gap-4 text-[12px] font-sans text-ink3
    Link /privacy → "Privacy"
    span → "·"
    Link /terms → "Terms"
    span → "·"
    span → "v{NEXT_PUBLIC_APP_VERSION}" (from package.json via env)
```

### SignOutBtn (NEW)
```
button mx-4 mt-5 w-[calc(100%-2rem)]
       bg-paper border-line rounded-[20px] py-3 text-ink font-sans text-[14px] font-medium
       active:bg-cream transition
       onClick={signOut}
  "Sign out"
```

### DeleteAccountBtn (NEW)
```
div px-4 mt-3 mb-6 flex justify-center
  button text-red-600 font-sans text-[12px] underline
    "Delete account"
AlertDialog (shadcn) on click
  content
    h3 font-serif text-[17px] text-ink → "Delete account?"
    p font-sans text-[13px] text-ink2 → "This will permanently remove your account, loyalty stars, and order history. This cannot be undone."
    div flex gap-2 justify-end mt-4
      button cancel bg-paper border-line px-4 py-2 rounded-full → "Cancel"
      button confirm bg-red-600 text-white px-4 py-2 rounded-full
        onClick → await POST /api/account/delete → signOut() → router.replace('/')
        → "Delete"
```

---

## Data Flow

### AuthProvider extensions (`src/components/auth/AuthProvider.tsx`)

Add:
- `deleteAccount: () => Promise<void>` — calls `POST /api/account/delete`, on success calls internal `signOut` + `router.replace('/')`. Route already exists.

No change to profile / loyalty / welcomeDiscount / starsPerReward / signOut / refresh.

### Loyalty events hook (`src/hooks/use-loyalty-events.ts` — NEW)

Thin client-side fetch:
```ts
export function useLoyaltyEvents() {
  const { profile } = useAuth()
  const [events, setEvents] = useState<LoyaltyEvent[]>([])
  useEffect(() => {
    if (!profile) return
    fetch('/api/loyalty/events', { cache: 'no-store' })
      .then(r => r.json()).then(j => setEvents(j.events ?? []))
  }, [profile?.user_id])
  return events
}
```
Used only in account page.

### API route `GET /api/loyalty/events`

**Verify first** — it may already exist (ref in `.claude/loyalty.md`). If missing, create `src/app/api/loyalty/events/route.ts`:
```
1. Session → customer → loyaltyAccount lookup (reuse existing helpers)
2. squareClient.loyalty.searchEvents with loyaltyAccountFilter
3. Return { events: [{id, type, points, createdAt}] } — strip PII, ~20 rows
```

---

## New Dependencies

- **qrcode.react** — verify installed (current web `MemberQrCard` likely uses it; read to confirm). Add if missing.
- `next/font/google` — built into Next, no install.
- `lucide-react` — already present per other pages.

Nothing else. No framer-motion, no linear-gradient lib, no reanimated shim.

---

## Icon Mapping (RN → lucide-react)

| RN `Icon name` | web `lucide-react` |
|---|---|
| `star` | `<Star fill="currentColor" />` |
| `arrow` | `<ArrowRight />` |
| `chevR` | `<ChevronRight />` |
| `gift` | `<Gift />` |
| `card` | `<CreditCard />` |
| `apple` | inline SVG (hand-write; lucide has no Apple glyph) |
| map-pin / phone / clock | `<MapPin> <Phone> <Clock>` |

---

## Verification Plan

Dev server assumed running on :3000 (PID 58270 per last handoff).

1. `npm run typecheck` → exit 0
2. `cmux list-panes` — if no browser pane on :3000, `cmux new-pane --type browser --direction right --url http://localhost:3000/account`
3. Signed-in state:
   - `cmux browser goto http://localhost:3000/account`
   - `cmux browser screenshot --out /tmp/cmux-account-mobile.png` (emulated mobile viewport)
   - Read `/tmp/cmux-account-mobile.png` and visually diff against screenshot Image #27 line-by-line:
     - ✅ Peach gradient avatar with initials
     - ✅ Name serif 22px + phone mono
     - ✅ Brown gradient LoyaltyCard, peach dot eyebrow, balance + " / N stars", Member pill
     - ✅ Nine cup-row icons (current filled peach, rest stroke)
     - ✅ Inline "Redeem →" CTA (peach bg when reward ready; white/18 bg otherwise)
     - ✅ Three MiniStats tiles, serif number + mono label
     - ✅ MemberQrCard with QR left + title + memberId + Expand pill
     - ✅ Save-card row with Apple "Open" or "Add to Wallet" CTA
     - ✅ Peach→cream gradient PromotionsCard with "Use" pill
     - ✅ Orders list, activity, store info, legal, sign out, delete
4. Cross-page visual regression (brand + bg changed globally):
   - `cmux browser goto /` → screenshot
   - `cmux browser goto /menu` → screenshot
   - `cmux browser goto /cart` → screenshot
   - `cmux browser goto /checkout` → screenshot (signed-in, empty cart or skip)
   - Read each screenshot. Look for: low-contrast red-on-bg references (any remaining `#C43A10` hardcode), broken buttons, FOUT of fonts.
5. `cmux browser errors list` + `cmux browser console list` after each page — must be empty.
6. User visual sign-off on `/account` screenshot.

---

## Risks & Rollback

- **Global brand color switch**: any page hardcoding `#C43A10` (instead of reading `BRAND.primaryColor`) stays red and looks broken. Grep before ship: `rg '#C43A10' src`. Either migrate each to `BRAND.primaryColor` import or scope exempt.
- **Font CLS**: 3 Google Fonts + `display: 'swap'` + CSS vars — FOUT expected first ~200ms. Acceptable.
- **ActivityHistory endpoint**: `/api/loyalty/events` may not exist. Plan step verifies; if missing, adds thin route.
- **Rollback**: revert `BRAND.primaryColor` + `<body>` bg + remove font imports + delete account page changes in one reverse commit. Token file / Tailwind extend can stay (no runtime impact if unused).

## Out of Scope

- Home / menu / cart / checkout / order-confirmation layout refits (follow-up tasks).
- Dark mode.
- i18n.
- Global `<Footer>` component changes.
- Changing accent color `#F5E6C8`.
