# Mandy's Bubble Tea — Claude Instructions

## Project Overview

A custom Next.js e-commerce site for Mandy's Bubble Tea, replacing Square Online with a fully branded experience powered by Square API.

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **Payments**: Square Web Payments SDK
- **Backend**: Square API (Catalog, Orders, Payments, Loyalty, Customers)
- **Deployment**: Vercel

## Brand

- **Primary color**: `#C43A10` (brick red)
- **Accent color**: `#F5E6C8` (cream)
- **Font**: System sans-serif
- **Tone**: Friendly, casual, bubble tea shop vibe

## Module Docs

Read these before working on each area:

- `.claude/square-api.md` — Square client setup, BigInt handling, error handling
- `.claude/catalog.md` — Menu, categories, item cards
- `.claude/cart-checkout.md` — Cart state, checkout flow, order creation
- `.claude/payment.md` — Square Web Payments SDK, Apple Pay
- `.claude/loyalty.md` — Stars system, loyalty card, progress bar
- `.claude/account.md` — User account page, phone-based lookup
- `.claude/deployment.md` — Vercel, env vars, domain setup

## Key Rules

- Always use `serializeSquareResponse()` when returning Square API data — BigInt will break JSON serialization
- Never expose `SQUARE_ACCESS_TOKEN` to the client — server-only
- All Square money amounts are in **cents as BigInt** — use `toCents()` and `toDollars()` helpers
- Use `NEXT_PUBLIC_` prefix only for env vars needed in the browser
- Tailwind only — no inline style except for brand colors
- All API routes in `src/app/api/`
- Components in `src/components/[feature]/`

## Project Structure

```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx               # Home
│   ├── menu/page.tsx          # Category grid
│   ├── menu/[category]/page.tsx
│   ├── cart/page.tsx
│   ├── checkout/page.tsx
│   ├── order-confirmation/page.tsx
│   ├── account/page.tsx       # Loyalty + order history
│   └── api/
│       ├── catalog/route.ts
│       ├── orders/route.ts
│       ├── payment/route.ts
│       ├── loyalty/account/route.ts
│       ├── loyalty/events/route.ts
│       └── customer/route.ts
├── components/
│   ├── layout/
│   ├── menu/
│   ├── cart/
│   ├── checkout/
│   └── account/
├── lib/
│   ├── square.ts              # Square client
│   ├── constants.ts           # Brand, loyalty config
│   └── utils.ts               # BigInt helpers, formatPrice
├── store/
│   └── cart.ts                # Zustand cart
└── types/
    └── square.ts
```

## Loyalty System

- **Unit**: Stars (⭐)
- **Rule**: 1 drink = 1 star (across all 7 categories)
- **Reward**: 9 stars = Free Drink of Your Choice
- **Categories**: MILKY, FRUITY, SPECIAL MIX, FRESH BREW, FRUITY BLACK TEA, FROZEN, CHEESE CREAM
- Configured in Square Dashboard — no code changes needed for rules

## Business Info

- **Name**: Mandy's Bubble Tea
- **Address**: 34 Davenport St, Southport QLD 4215
- **Phone**: 0404 978 238
- **Domain**: mandybubbletea.com
- **Timezone**: Australia/Brisbane
- **Currency**: AUD

## System
Cross-project tracking lives in `~/system/`. Check `~/system/DEV_QUEUE.md` for priorities if needed.
