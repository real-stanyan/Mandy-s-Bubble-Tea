# Mandy's Bubble Tea — Project Status

_Last updated: 2026-04-09_



A custom Next.js 16 storefront replacing Square Online for Mandy's Bubble Tea
(Southport QLD). Square is the single source of truth for catalog, orders,
payments, customers, and loyalty — this app is a branded shell that talks to
the Square APIs.

## Stack

- **Framework**: Next.js 16 (App Router, React Server Components)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State**: Zustand (cart, with localStorage persistence)
- **Payments**: Square Web Payments SDK (card tokenization + SCA / 3DS)
- **Backend**: Square SDK v44 — Catalog, Customers, Orders, Payments, Loyalty
- **Deployment target**: Vercel (not yet deployed)

## Architecture

```
src/
├── app/
│   ├── layout.tsx                 # Root layout, mounts CartDrawer globally
│   ├── page.tsx                   # Home: hero + featured categories + loyalty teaser + visit
│   ├── menu/
│   │   ├── page.tsx               # Category grid
│   │   ├── [category]/page.tsx    # Item list
│   │   └── [category]/[item]/page.tsx  # Item detail + ItemOrderForm
│   ├── checkout/page.tsx          # Web Payments SDK + SCA + order/payment
│   ├── order-confirmation/[orderId]/page.tsx  # Server-rendered from Square
│   ├── account/page.tsx           # Phone lookup + stars + order history
│   └── api/
│       ├── catalog/route.ts       # Catalog fetch + shape
│       ├── locations/route.ts
│       ├── customer/route.ts      # Lookup-or-create by phone
│       ├── customer/lookup/route.ts   # Lookup-only (account page)
│       ├── orders/route.ts        # Create order (trusted pricing via Square)
│       ├── orders/history/route.ts    # Order list by customerId
│       ├── payment/route.ts       # Charge token + accrue loyalty
│       └── loyalty/account/route.ts   # Loyalty balance + program info
├── components/
│   ├── cart/{CartDrawer,CartIcon}.tsx
│   └── menu/ItemOrderForm.tsx
├── lib/
│   ├── square.ts                  # Server-only Square client
│   ├── catalog.ts                 # Catalog normalization
│   ├── constants.ts               # BRAND, BUSINESS, LOYALTY config
│   ├── loyalty.ts                 # Program cache + account lookup + accrual
│   ├── phone.ts                   # AU phone → E.164 normalization
│   ├── slugs.ts
│   └── utils.ts                   # BigInt money helpers, serializeSquareResponse
├── store/cart.ts                  # Zustand cart (hydration-aware)
└── types/square.ts
```

### Key conventions

- **Money**: BigInt cents everywhere server-side. `formatPrice()` + `toDollars()`
  for display. `serializeSquareResponse()` at every JSON boundary — raw BigInts
  would break `JSON.stringify`.
- **Trust boundary**: Clients send `variationId` / `modifierId` references only.
  Square recomputes all pricing against the live catalog. `/api/payment`
  re-reads the order's `totalMoney` so client-supplied amounts never influence
  what gets charged.
- **Phone as identity**: E.164 via `normalizeAuPhone()` is the canonical key
  that links Square Customer ↔ Loyalty Account.
- **Idempotency**: `randomUUID()` on every create (orders, payments, customers,
  loyalty accrual).
- **Error isolation**: Loyalty accrual is wrapped in try/catch inside
  `/api/payment` — a loyalty failure must never fail a successful payment.

## Completed slices

| Slice | What | Status |
|-------|------|--------|
| **A** | Square client bootstrap, env wiring, `serializeSquareResponse` | ✅ |
| **B** | Catalog fetch + normalization, menu routes | ✅ |
| **C** | Menu browsing (categories → items → detail) | ✅ |
| **D** | Item variations + modifiers via `ItemOrderForm` | ✅ |
| **E** | Zustand cart + `CartDrawer` (hydration-safe) | ✅ |
| **H1** | `/api/customer` + `/api/orders` + `/checkout` skeleton + confirmation page | ✅ |
| **H2** | Square Web Payments SDK, card form, tokenize → `verifyBuyer` (SCA) → `/api/payment` | ✅ |
| **I1** | Loyalty accrual on payment success (`findOrCreateLoyaltyAccount` + `accumulatePoints`) | ✅ |
| **I2** | Checkout rewards redemption UI (phone-blur loyalty lookup + redeem checkbox) | ✅ |
| **J**  | `/account` page: phone lookup, stars progress bar, order history | ✅ |
| **F**  | Home page rebrand (hero, featured categories, loyalty teaser, visit) | ✅ |

### Payment flow (as built)

```
cart → /api/customer (lookup-or-create)
     → /api/orders    (Square computes total, returns amountCents)
     → card.tokenize()
     → payments.verifyBuyer(token, { amount, AUD, billingContact })   ← SCA
     → /api/payment   (re-reads order total, charges, accrues loyalty)
     → /order-confirmation/[orderId]
```

### Loyalty model

- One active program per Square account, resolved via the `"main"` sentinel
  in `lib/loyalty.ts`. Program id + `starsPerReward` cached in module scope.
- 1 drink = 1 ⭐, 9 ⭐ = free drink (configured in the Square Dashboard —
  `starsPerReward` is read from the program's reward tiers with a fallback to
  `LOYALTY.starsPerReward = 9`).
- Accrual uses `accumulatePoints({ orderId })` — Square computes points itself
  based on the program's accrual rules.

## In progress

Nothing actively in progress. F just landed, ready to pick the next slice.

## Pending work

### G — Shared layout + navigation
- Extract the header inline in `/` (slice F) into a shared component
  so `/menu`, `/checkout`, `/account`, `/order-confirmation` all use
  the same chrome. Currently each page has its own header band and
  the nav (Menu / Account / Cart) only exists on `/`.
- Fix theme color metadata in `layout.tsx`.
- Review mobile nav.

### Deployment
- Vercel project setup + env vars (`SQUARE_ACCESS_TOKEN`,
  `SQUARE_LOCATION_ID`, `NEXT_PUBLIC_SQUARE_APP_ID`,
  `NEXT_PUBLIC_SQUARE_LOCATION_ID`, `NEXT_PUBLIC_SQUARE_ENVIRONMENT`)
- Production domain: `mandybubbletea.com`
- **Apple Pay domain verification** (Square Dashboard → Web Payments →
  register domain, drop `.well-known/apple-developer-merchantid-domain-association`)
- Swap Web Payments SDK to production CDN via `NEXT_PUBLIC_SQUARE_ENVIRONMENT=production`
- **Update `LOYALTY.squareProfileUrl` in `src/lib/constants.ts`** with the real
  URL from Square Dashboard → Loyalty → Settings → Profile URL. The Apple
  Wallet banner on `/account` is guarded by
  `NEXT_PUBLIC_SQUARE_ENVIRONMENT === "production"` and only appears once this
  is set (sandbox has no equivalent `profile.squareupsandbox.com` host).

## Known issues / gotchas

- **Square Sandbox test cards are whitelisted.** `4111 1111 1111 1111` works
  with CVV `111`; `4310 0000 0000 0007` has been flaky for SCA in AU.
- **Orders without payment don't show in the Square Dashboard Orders page.**
  This caused confusion during H1 testing — the order exists, it's just
  filtered out until a payment lands.
- **SCA is mandatory for AU online payments.** Skipping `verifyBuyer` triggers
  `CARD_DECLINED_VERIFICATION_REQUIRED`. The amount passed to `verifyBuyer`
  must match the amount Square will actually charge — that's why
  `/api/orders` returns `amountCents`.
- **Loyalty program must exist in the Square account** before accrual works.
  Early sandbox testing hit a silent failure because no program was
  configured — logs now surface `[payment] loyalty accrual failed: …`.
- **Next 16.2.3 dev HMR crash: `RangeError: Map maximum size exceeded`.**
  Long dev sessions crashed at `AsyncHook.init` in
  `app-page-turbo.runtime.dev.js`. Root cause: the async generator in
  `subscribe()` (`node_modules/next/dist/build/swc/index.js`) creates 3–4
  async hook IDs per HMR event, overflowing React's `pendingOperations` Map
  (~16M entries) faster than GC can drain. Patched locally via
  `patch-package` applying vercel/next.js#91704 — see
  `patches/next+16.2.3.patch`. **Remove the patch when #91704 lands in an
  upstream Next release** (check on every Next upgrade).

## Environment variables

Server-only:
- `SQUARE_ACCESS_TOKEN`
- `SQUARE_LOCATION_ID`
- `SQUARE_ENVIRONMENT` (`sandbox` | `production`)

Browser-safe (`NEXT_PUBLIC_` prefix):
- `NEXT_PUBLIC_SQUARE_APP_ID`
- `NEXT_PUBLIC_SQUARE_LOCATION_ID`
- `NEXT_PUBLIC_SQUARE_ENVIRONMENT`

## Business info

- **Name**: Mandy's Bubble Tea
- **Address**: 34 Davenport St, Southport QLD 4215
- **Phone**: 0404 978 238
- **Domain**: mandybubbletea.com
- **Timezone**: Australia/Brisbane
- **Currency**: AUD
