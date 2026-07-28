# ADR 0003 — Checkout preview stays a client mirror (for now)

Status: **superseded by ADR 0005 (2026-07-28)** — accepted 2026-07-27
Issue: #73, `real-stanyan/Mandy-s-Bubble-Tea-App#40`
Supersedes nothing. Extends ADR 0002.

> The follow-up this ADR named ("server quote endpoint, shared, both mirrors
> deleted together") was done the next day. Both mirrors are gone; checkout
> renders `POST /api/orders/quote`. See `docs/adr/0005-checkout-renders-a-server-quote.md`.
> Kept for the reasoning that made the mirror the right call at the time.

## Context

Both checkout surfaces — the web `src/app/checkout/page.tsx` and the app
`app/checkout.tsx` — price the cart **client-side**. Neither asks the server
what the order will cost; each re-implements the discount math so the summary
and the Apple/Google Pay sheet can be rendered before an order exists.

That mirror was already carrying welcome, IG-follow, tier 5%, free toppings,
loyalty rewards and the flash promo. When ADR 0002's app-download discount
landed server-side, nobody added it to the mirror — so a customer holding the
20% grant saw only the smaller Welcome row and a total higher than what Square
would actually capture. Verified end-to-end on a localhost stack (#72).

No money was at risk: `/api/payment` re-reads the created order's total and
ignores the client's amount (see the comment at `src/app/api/payment/route.ts`).
The defect is that the promo's own checkout screen contradicts the promo.

This blocked the launch of a campaign whose card reads
"20% OFF — auto-applied at checkout".

## Decision

**Extend the client mirror to cover app-download; do not build the server quote
endpoint yet.**

The mirror follows the existing shape exactly: app-download is exclusive and
sits one lane *above* flash, replacing whichever discount survived — flash OR
the welcome/IG/tier bundle — when it is worth more, on the same base
(`subtotal − reward cups`). This is the fifth promo to go through the same
mirror; it introduces no new pattern.

## Alternatives considered

**Server quote endpoint** — checkout calls it on load and renders whatever it
returns, making `/api/orders` the single pricing source of truth and deleting
both mirrors. This is the *correct* design and is where this should end up. It
was rejected **for this launch only**, because it moves the entire checkout
summary (surcharges, PH surcharge, loyalty redeem, delivery quote, free
toppings) onto a new endpoint on both surfaces — a change whose blast radius
is the payment path, taken under launch pressure, to fix a display bug.

## Consequences

- The mirror can drift from the server. It already has once: that is this ADR.
  Every future promo must be added in **three** places (server, web mirror, app
  mirror) or it silently under-reports.
- Drift is bounded to display: the charged amount comes from the order.
- #73 and app#40 stay **open** and hold the quote-endpoint design. They are one
  decision, not two — the endpoint should be shared, and both mirrors deleted
  in the same change.

## What would invalidate this

A sixth promo, or any promo whose server-side math the client genuinely cannot
reproduce (e.g. priced off catalog data the client doesn't hold). At that point
the mirror stops being cheap and the quote endpoint should be built instead of
extended again.
