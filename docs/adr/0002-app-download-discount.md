# ADR 0002 — App-download discount: phone-anchored, exclusive, whole-order

Status: accepted (2026-07-24)
Issue: #68

## Context

A web campaign shows a popup: "download the app, get 20% off one order." The
hard problem is attribution — the app has no way to know a given install came
from the web popup carrying a discount. Classic solutions (Branch / Adjust /
AppsFlyer deferred deep links) are install-attribution machinery, disproportionate
for a single bubble-tea shop.

## Decision

**Anchor the discount to phone-number identity, not to the install.** Attribution
to an install is hard; attribution to an identity is trivial. The web popup
collects a phone number and mints a grant keyed by that phone. When the user
later downloads the app and signs in, their profile already carries `phone_e164`,
which resolves straight to the grant. No deep link, no SDK, no install attribution.

This reuses the existing promo machinery rather than inventing new mechanics. The
grant mirrors `flash_promos` money semantics (whole-order percentage, one order,
one-shot burn) but is **claim-gated per phone** instead of store-wide.

Three product decisions (set by Stan / real-stanyan):

1. **Exclusive, better-of.** Does not stack with welcome / ig-follow / tier /
   flash. It competes in the same exclusive lane as flash: it replaces the whole
   attached discount set only when it is worth more (`amount > currentAttached`).
   A 20% coupon stacking on top of tier + welcome would over-discount.
2. **Whole-order 20%.** "One order 20% off" is taken literally — 20% of the
   authoritative drinks subtotal (minus loyalty-reward cups), same math as flash.
3. **No OTP on claim.** Honor system, matching ig-follow/flash altitude. The
   per-phone primary key is the entire dedup defence. Claiming a stranger's phone
   only grants the discount to that phone's real owner — who alone can sign into
   the app and redeem it — so grief is inherently bounded.

## Consequences

- New table `app_download_grants` (phone PK) + `consume_app_download_discount`
  RPC (update-if-unredeemed, idempotent one-shot burn).
- `src/lib/app-download-discount.ts` — claim / status / consume, mirroring
  `ig-follow-discount.ts` + `flash-promo.ts`.
- Two public routes: `POST /api/promotions/app-download/claim` (no auth, phone
  in body) and `GET /api/promotions/app-download/status` (authed, by profile
  phone).
- `orders/route.ts` attaches the discount server-authoritatively (auto-applied
  from the signed-in user's phone; no trusted client flag), in the exclusive
  better-of lane after flash.
- Both burn paths — `payment/route.ts` (pickup) and `consume-order-discounts.ts`
  (delivery accept) — consume it, keyed by the order's fulfillment recipient
  phone (the grant is phone-keyed, not customer-keyed).

## Trade-offs / when to revisit

- **Grief premise**: honor-system claim assumes claiming a stranger's phone is
  low-value abuse. If claim volume becomes a DB-bloat problem, add IP
  rate-limiting (noted TODO in the claim route) — a storage mitigation, not a
  fraud one. If actual fraud appears, escalate to OTP verification.
- **Exclusive-vs-stack** is the reversible knob: if the campaign underperforms
  because it never stacks for members, revisit decision 1.
- **Phone-keyed burn** assumes every order carries a recipient phone on its
  PICKUP fulfillment (true today — `/api/orders` always stamps it, and the order
  route already 401s without `profile.phone_e164`). If order creation ever stops
  stamping the phone, the burn silently no-ops and the ticket could be reused.
