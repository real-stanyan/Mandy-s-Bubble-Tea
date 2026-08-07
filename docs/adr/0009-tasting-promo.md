# ADR 0009 — Tasting promo: item-level flat price, app-only, one cup per order

Status: accepted (2026-08-07)
Issue: #146

## Context

A new drink launches and needs trial: "Strawberry Matcha Milk Tea, $5 for app
users, five days." Every promo the pricing engine already knows how to give is
whole-order — welcome and IG-follow are percentages off picked cups, tier is a
percentage of what the customer pays, flash and app-download are percentages of
the whole order. None of them can express "this one drink costs $5 today".

Issue #146 arrived as a set of operational steps (migration, insert, push, EAS
update) asserting the code was already written. It was not: nothing existed in
any branch of either repo, no PR, no commits — only the issue. This ADR covers
the implementation built from that issue's spec.

## Decision

A `tasting_promos` row names a **product** (Square catalog item name), a **flat
price in cents**, and a **window**. While the window is open, an app order gets
the named drink at that price.

Five decisions worth writing down, because each had a plausible alternative:

1. **Named product, not a variation id.** The promo is authored against the item
   NAME and matched case/whitespace-insensitively at pricing time. A variation id
   would break on a size split, and would silently turn the promo off if the item
   were deleted and re-added in Square (which is exactly how `unknownVariationIds`
   came to exist). The cost is that renaming the drink in Square turns the promo
   off — visible and recoverable, unlike a stale id.

2. **Toppings are not part of the tasting price.** The discount is sized from the
   VARIATION price alone, so a $5 tasting cup with $1.20 of pearls costs $6.20.
   "The drink is $5" stays true without handing out free toppings, and it matches
   how the counter rings it up.

3. **One cup per order.** There is no per-customer grant row — the window is the
   only bound — so an uncapped tasting price would let one order take twenty cups
   at cost. A customer who wants two places two orders; that friction is the
   point. `TASTING_CUPS_PER_ORDER` is the single knob.

4. **Exclusive, better-of — the same lane as flash and app-download.** The order
   gets the single largest discount, never two. This keeps the engine's invariant
   ("never discount the same dollar twice") true by construction. The cost is
   real and accepted: a brand-new customer's 30% welcome, or an unburned
   app-download ticket, can be worth more than the tasting saving and will win —
   so the app copy must promise the *best* price, not "always $5". The customer
   is never worse off; only the wording can be.

   Reward cups are handled inside the tasting math instead: the cheapest N cups
   (the ones a loyalty star already makes free) are removed from the pool before
   matching, mirroring `pickPromoCups` and the flash/tier bases.

5. **App-only, resolved from request headers.** `clientPlatformFrom()` decides,
   server-side, in BOTH `POST /api/orders` and `POST /api/orders/quote` — the
   quote is what the customer reads and the create call is what they pay, so a
   promo visible to one and not the other is a wrong price (ADR 0005). The
   request body never gets a say. Unknown clients default to `web`, which
   under-promises rather than over-promises.

Announcement is one endpoint, `POST /api/promotions/tasting-promo/send`,
admin-gated. It reads the money out of the promo row rather than the request
body (a body that disagrees is rejected, not silently honoured) because the push
promises a price and the only price that can be honoured is the one the pricing
engine will read back. There is no per-recipient cooldown table for this promo,
so double-send is prevented by claiming `pushed_at` with a conditional update —
exactly one caller wins; a failed send releases the claim; `force: true` is the
deliberate second wave.

## Consequences

- Renaming the drink in Square silently ends the promo. Accepted (see 1) — the
  failure is visible in the app card, which reads the same row.
- The app card must say "best price applied at checkout", not a bare "$5", or
  decision 4 will read as a bug to a new customer whose welcome discount wins.
- `AuthoritativePriceMaps` now carries `itemNameByVariationId`. Item-level promos
  need to know what a cup *is*, not just what it costs; the name comes from the
  catalog for the same reason the price does — the client is never asked.
- The app-side card and push handler live in `Mandy-s-Bubble-Tea-App` and are not
  part of this change.
