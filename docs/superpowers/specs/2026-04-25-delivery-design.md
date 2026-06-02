# Delivery (Uber Direct) — Design Spec

**Status**: Draft (awaiting user review)
**Author**: Claude (Opus 4.7) + stan
**Date**: 2026-04-25
**Branch**: `feat/delivery`
**Related**: extends pickup-only checkout flow; reuses PH surcharge + card surcharge architecture from `2026-04-24-public-holiday-surcharge-design.md`

---

## 1. Goal

Add delivery as a fulfillment option to mandybubbletea.com checkout. Customers in a 10 km radius of the Southport store can have their order dispatched via Uber Direct (white-label) without leaving the site.

Pickup remains the default; delivery is opt-in at checkout.

## 2. Non-Goals

- **No UberEats marketplace listing**. We are not paying 30% commission to be on the UberEats consumer app. Delivery happens on-site, with Uber Direct as the dispatch carrier only.
- **No scheduled delivery in v1**. ASAP only.
- **No native RN app delivery in v1**. Web only this round; app port is a separate spec.
- **No multi-store routing**. Mandy's has one store; the dispatch origin is hard-coded to 34 Davenport St.
- **No third-party marketplace fallback**. If Uber Direct can't dispatch, we refund — we do not silently swap to DoorDash Drive or Menulog.

## 3. Locked decisions (from brainstorming)

| Decision | Value | Reasoning |
|---|---|---|
| Delivery provider | **Uber Direct** white-label | Customer pays Mandy directly, Uber dispatches. Zero commission, customer relationship stays with Mandy. |
| Account status | **Not yet acquired**, develop with sandbox/mock | Phase 1–3 unblock by mocking; Phase 4 connects real API. |
| Selector location | **Checkout page only** | Cart drawer stays clean; minimal scope. |
| Address input UX | **Google Places Autocomplete** | Need precise lat/lng for Uber API; best-known UX in AU. |
| Radius cap | **10 km** | Covers Southport → Coomera/Burleigh; matches Mandy's wider reach ambition. |
| Minimum order | **$18** drinks subtotal | Below this, delivery economics don't work. |
| Customer-facing delivery fee | **$4.99** flat (subtotal $18 ≤ x < $35) / **FREE** ($35+) | Simple, predictable, marketing-friendly. |
| Service Fee | **8% × drinks subtotal**, always charged | Even at $35+ free-delivery tier; offsets shop's Uber absorption. |
| Shop economics | Shop privately absorbs all Uber bill (~$8–$15/order). Customer never sees raw Uber fee. | "$7 we cover" = Mandy's mental break-even, not a code constant. |
| Scheduling | **ASAP only** | 95% of v1 use cases. |
| Delivery hours | **11:00–21:30 Brisbane** (tighter than pickup's 10:30–22:30) | Buffer for Uber driver supply at open/close. |
| Loyalty | **Same as pickup** — earn 1 star/drink, can redeem free-drink reward (delivery fee + Service Fee still charged). | Consistency. |
| PH surcharge | **Applies to delivery** orders too | Same base = drinks subtotal. |

## 4. Pricing math (full breakdown)

### 4.1 Worked examples

```
Example 1: $20 order, normal day
  Drinks subtotal       $20.00
  Delivery Fee           $4.99
  Service Fee (8%)       $1.60   (8% × $20.00)
  Card surcharge (1.9%)  $0.51   (1.9% × $26.59)
  ─────────────────────
  Total                 $27.10

Example 2: $35 order, normal day
  Drinks subtotal       $35.00
  Delivery Fee           FREE   ($0.00; styled with strikethrough $4.99 above for marketing impact)
  Service Fee (8%)       $2.80   (8% × $35.00, NOT waived at $35+)
  Card surcharge (1.9%)  $0.72   (1.9% × $37.80)
  ─────────────────────
  Total                 $38.52

Example 3: $25 order on ANZAC Day (PH active)
  Drinks subtotal       $25.00
  Delivery Fee           $4.99
  Service Fee (8%)       $2.00   (8% × $25.00)
  PH surcharge (10%)     $2.50   (10% × $25.00)
  Card surcharge (1.9%)  $0.66   (1.9% × $34.49)
  ─────────────────────
  Total                 $35.15

Example 4: $18 order (minimum), normal day
  Drinks subtotal       $18.00
  Delivery Fee           $4.99
  Service Fee (8%)       $1.44   (8% × $18.00)
  Card surcharge (1.9%)  $0.46   (1.9% × $24.43)
  ─────────────────────
  Total                 $24.89

Example 5: Free-drink reward redeemed on delivery (1 of 3 drinks free)
  Drinks before reward  $21.00   (3× drinks @ $7)
  Reward discount      -$7.00   (1 drink free)
  Drinks subtotal       $14.00   (BELOW $18 — DELIVERY DISALLOWED)
  → enforced at checkout: reward + delivery requires post-discount subtotal ≥ $18
```

### 4.2 Validation truth table

| Drinks subtotal (post-reward) | Delivery available? | Delivery Fee | Service Fee |
|---|---|---|---|
| $0 – $17.99 | NO (button disabled, helper "Add $X to enable delivery") | — | — |
| $18.00 – $34.99 | YES | $4.99 | 8% × subtotal |
| $35.00+ | YES | FREE ($0.00) | 8% × subtotal |

Card surcharge (1.9%) applies on top of (drinks + delivery + service + PH if applicable).

### 4.3 Service charge ordering on Square Order

`fulfillments[0].deliveryDetails` defined; `serviceCharges[]` array order:

1. PH surcharge (only when `getActivePublicHoliday(now)` returns truthy)
2. Delivery Fee
3. Service Fee (8%)
4. Card surcharge (1.9%)

Ordering matters for receipt printing readability.

## 5. Architecture

### 5.1 Sequence diagram

```
Browser                         Server                          Uber Direct
─────────                       ──────                          ────────────
1. Customer selects Delivery
   + types address
   ──── POST /api/delivery/quote ──►
                                   │
                                   ├── Haversine: store↔dest ≤ 10km? ─── (local)
                                   │
                                   ├── POST /v1/customers/{id}/delivery_quotes ──►
                                   │                                              │
                                   ◄────── { quote_id, fee, eta_min, expires } ───┤
                                   │
   ◄── { ok, etaMin, expiresAt, quoteId } ──┤

2. Customer hits Place Order
   ──── POST /api/orders ────────►
                                   │
                                   ├── Square /v2/orders (DELIVERY fulfillment + serviceCharges) ──► (Square)
                                   │                                                                  │
                                   ◄────────────────────────────────────────────── { orderId } ──────┤
   ◄── { orderId } ──────────────┤

3. Square Web Payments SDK tokenizes card
   ──── POST /api/payment ───────►
                                   │
                                   ├── Square /v2/payments ──► (Square)
                                   │                            │
                                   ◄──────── COMPLETED ────────┤
                                   │
                                   ├── (existing) loyalty + welcome discount logic
                                   │
                                   ├── dispatchUberDelivery(orderId)  [NEW]
                                   │   │
                                   │   ├── POST /v1/customers/{id}/deliveries (with quote_id) ──►
                                   │   │                                                        │
                                   │   ├── retry 3x w/ exponential backoff on 5xx              │
                                   │   │                                                        │
                                   │   ◄────────────── { delivery_id, tracking_url } ─────────┤
                                   │
                                   ├── Square: write metadata { uber_delivery_id, uber_tracking_url }
                                   │
   ◄── { ok, paymentId, deliveryTrackingUrl } ──┤

4. Browser → /order-confirmation/[orderId]
   shows tracking_url + ETA

5. Async: Uber dispatches, picks up, delivers
   Uber Direct ──── POST /api/webhooks/uber ──► Server
                                                  │
                                                  ├── HMAC verify
                                                  ├── Square: update fulfillment.state
                                                  ├── push notification (delivered etc.)
```

### 5.2 New files

```
src/lib/uber-direct.ts          OAuth client + quote + delivery + webhook parser
src/lib/delivery-fee.ts         Pricing rules: $4.99 / FREE / 8% Service Fee
src/lib/delivery-hours.ts       11:00–21:30 Brisbane TZ window
src/lib/places.ts               Haversine distance helper + store coords constant
src/components/checkout/FulfillmentSelector.tsx
src/components/checkout/DeliveryAddressForm.tsx
src/components/checkout/DeliveryQuoteCard.tsx
src/app/api/delivery/quote/route.ts
src/app/api/webhooks/uber/route.ts
```

### 5.3 Modified files

```
src/app/api/orders/route.ts     accept fulfillmentType=DELIVERY; build deliveryDetails + new service charges
src/app/api/payment/route.ts    on COMPLETED → call dispatchUberDelivery() + write metadata
src/app/checkout/page.tsx       integrate FulfillmentSelector + new state
src/components/checkout/SummaryBlock.tsx     render Delivery Fee + Service Fee rows
src/components/cart/CartDrawer.tsx           add small footer hint "Pickup or delivery? Choose at checkout →"
src/app/order-confirmation/[orderId]/page.tsx     render tracking URL button when delivery
src/components/account/OrderRow.tsx          add "Track" link for delivery orders
src/lib/constants.ts            DELIVERY_FEE_CENTS=499n, SERVICE_FEE_BPS=800n, FREE_DELIVERY_THRESHOLD_CENTS=3500n, MAX_DELIVERY_KM=10, DELIVERY_HOURS_OPEN/CLOSE, STORE_LAT/LNG
```

### 5.4 New environment variables

```
UBER_DIRECT_CUSTOMER_ID         (server-only)
UBER_DIRECT_CLIENT_ID           (server-only)
UBER_DIRECT_CLIENT_SECRET       (server-only)
UBER_DIRECT_WEBHOOK_SECRET      (server-only)
UBER_DIRECT_MODE                "mock" | "sandbox" | "production" (default "mock" in dev)
GOOGLE_PLACES_API_KEY           (server-only, for distance verification fallback)
NEXT_PUBLIC_GOOGLE_PLACES_API_KEY    (browser, restrict by HTTP referrer to mandybubbletea.com + localhost)
NEXT_PUBLIC_STORE_LAT=-28.0084
NEXT_PUBLIC_STORE_LNG=153.4116
NEXT_PUBLIC_DELIVERY_ENABLED    "true" | "false" (Phase 5 dark-launch gate, default false)
```

### 5.5 No new database tables

Delivery state is persisted entirely via:
- **Square order metadata**: `uber_delivery_id`, `uber_tracking_url`, `delivery_address`, `delivery_lat`, `delivery_lng`, `delivery_quote_id`
- **Square fulfillment.state**: PROPOSED → RESERVED → PREPARED → COMPLETED / CANCELED (driven by Uber webhook)

This avoids Supabase migration overhead and keeps Square as single source of truth (matching existing pickup architecture).

## 6. UI / Customer flow

### 6.1 Checkout page layout (delivery selected)

```
┌─────────────────────────────────────────────────────────────┐
│ Order Summary                                                │
│   3× Brown Sugar Milk Tea  ........  $20.00                 │
├─────────────────────────────────────────────────────────────┤
│ How would you like it?                                       │
│   ⚪ Pickup at 34 Davenport St (Ready in ~10 min)           │
│   ⚫ Delivery ($4.99 · ~25 min)                             │
├─ DELIVERY EXPANDED ─────────────────────────────────────────┤
│ Delivery Address                                             │
│   [Google Places autocomplete input]                         │
│ Apartment / Unit (optional)  [_____]                         │
│ Note for driver (optional)   [textarea, 120 char cap]        │
│ Phone (required)             [_____]                         │
│ ┌─ Quote card after address valid ──────────────────────┐   │
│ │ ✓ Delivery available · ETA ~25 min                    │   │
│ └────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│ Drinks subtotal                            $20.00           │
│ Delivery Fee                                $4.99           │
│ Service Fee (8%)                            $1.60           │
│ [PH surcharge (10%) (ANZAC Day)             $2.00]    ←PH   │
│ Card surcharge (1.9%)                       $0.51           │
│                                          ────────           │
│ Total                                      $27.10           │
│                                                              │
│ [ Place Order ]   ← disabled if any validation fails        │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 Place Order button enable conditions

All of the following must be true for delivery:

| Condition | Required |
|---|---|
| Cart non-empty | always |
| Drinks subtotal (post-reward) ≥ $18 | delivery only |
| Phone provided (E.164 valid) | **delivery only** (pickup keeps phone optional) |
| Address selected via Google Places (has lat/lng) | delivery only |
| Quote `ok: true` returned by `/api/delivery/quote` | delivery only |
| Quote not expired (`expiresAt > now`) | delivery only |
| Current time within delivery hours (11:00–21:30 Brisbane) | delivery only |

### 6.3 Helper text on disabled state

| Failure | Helper text below button |
|---|---|
| Subtotal < $18 | "Add $X to enable delivery" (computed) |
| No phone | "Phone required for delivery" |
| Address invalid | "Select an address from the dropdown" |
| Out of zone | "Sorry, we don't deliver to that address" |
| Outside delivery hours | "Delivery hours: 11am–9:30pm" |
| Quote expired | (auto re-quote on focus; brief spinner) |

### 6.4 Cart drawer hint

Small grey footer text in `CartDrawer.tsx` (one line, no toggle):

> "Pickup or delivery? Choose at checkout →"

### 6.5 Order confirmation page

When `fulfillmentType === "DELIVERY"`:
- Replace pickup-time block with: "Estimated arrival: ~25–30 min" (from quote `etaMin` ± 5 min buffer; counts from order placement, not pickup)
- Add prominent button: **"Track your delivery →"** linking to `metadata.uber_tracking_url` (target=`_blank`)
- Loyalty stars block unchanged (already accrued at payment time)

### 6.6 Account page (Past Orders)

`OrderRow.tsx`: when delivery order has `metadata.uber_tracking_url` and state ∉ {COMPLETED, CANCELED}, render small "Track" link. Otherwise no change.

## 7. Failure modes & error handling

### 7.1 Failure matrix

| Failure stage | Symptom | Handling |
|---|---|---|
| Quote: address out of zone | quote returns `{ ok:false, reason:"out_of_zone" }` | UI shows red inline error; Place Order disabled; no order created |
| Quote: no driver available | quote returns `{ ok:false, reason:"no_driver" }` | Same as out_of_zone (rare during open hours on Gold Coast) |
| Quote: expired before checkout | `expiresAt < now` | Auto re-quote on checkout page useEffect/focus event; spinner during refetch |
| `/api/orders` 5xx | existing handling | No change; error toast |
| Payment FAILED (card declined) | `paymentStatus !== "COMPLETED"` | Existing logic (`1eddeb8`): welcome discount preserved, no Uber dispatch, order remains OPEN; user retries |
| Payment OK, Uber dispatch retry-exhausted | API 5xx 3× or `no_driver_available` | **Auto refund + cancel + notify** (see 7.2) |
| Driver can't find address (post-pickup) | Uber webhook `failed` (or `returned` if re-routed back to store) | Auto refund + push notification + email Mandy |
| Customer not home (post-arrival) | Uber webhook `returned` | No refund (customer fault); UI shows "Returned to store, contact shop"; email Mandy |
| Webhook delivery (Uber → us) drops | network blip | Cron `*/5 * * * *` polls `/v1/customers/{id}/deliveries/{id}` for orders in non-terminal state, syncs Square fulfillment state |

### 7.2 Payment-OK-but-Uber-fails handler

Implementation in `/api/payment` after Square payment marked COMPLETED:

```ts
// Pseudo-code
async function dispatchUberDelivery(orderId: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const delivery = await uberDirect.createDelivery({ quoteId, ... });
      await squareClient.orders.update({
        orderId,
        order: { metadata: { uber_delivery_id: delivery.id, uber_tracking_url: delivery.tracking_url } },
      });
      return { ok: true, trackingUrl: delivery.tracking_url };
    } catch (err) {
      if (err.status >= 500 && attempt < 3) {
        await sleep(5000 * Math.pow(3, attempt - 1)); // 5s, 15s, 45s
        continue;
      }
      // exhausted or non-retryable
      await refundPaymentInFull(paymentId);
      await squareClient.orders.update({ orderId, order: { state: "CANCELED" }});
      await notifyCustomerRefund(orderId);
      await notifyMandyDispatchFailure(orderId, err);
      return { ok: false, refunded: true };
    }
  }
}
```

The `/api/payment` response includes `deliveryTrackingUrl` if dispatch succeeded, or a `refunded: true` flag if it failed — checkout page redirects to `/order-confirmation` with a refund banner in the latter case.

### 7.3 Uber webhook handler (`/api/webhooks/uber`)

- **Auth**: HMAC-SHA256 signature in `x-uber-signature` header, verified against `UBER_DIRECT_WEBHOOK_SECRET`. 401 on mismatch.
- **Idempotency**: lookup Square order by `metadata.uber_delivery_id`; if `fulfillment.state` already matches incoming Uber status → 200 noop.
- **Event mapping**:

| Uber event | Square `fulfillment.state` | Side effect |
|---|---|---|
| `pending` | `RESERVED` | none |
| `pickup` | `PREPARED` | none |
| `pickup_complete` | `PREPARED` | push: "Driver picked up your order" |
| `dropoff` | `PREPARED` | push: "On the way" |
| `delivered` | `COMPLETED` | push: "Delivered ✓" (loyalty NOT re-granted; already given at payment time) |
| `canceled` (pre-pickup) | `CANCELED` | trigger refund + customer notification |
| `failed` (driver couldn't deliver) | `CANCELED` | trigger refund + push customer + email Mandy |
| `returned` (delivered back to store) | `CANCELED` | no refund (customer fault); notify Mandy to handle goods |

### 7.4 Mandy-side notifications

- **MVP**: email Mandy on dispatch failure / returned orders. Uses existing email transport if available; otherwise stub `notifyMandy()` that logs to Sentry/Vercel + a TODO to wire email.
- **v1.1**: optional Twilio SMS (out of scope for this spec).

## 8. Loyalty interaction

- **Star accrual**: existing logic — granted at payment COMPLETED. Delivery orders accrue 1 star per drink, identical to pickup. No change to `/api/payment` loyalty flow.
- **Free-drink reward redemption**: works on delivery orders. The reward zeros out one drink; remaining drinks subtotal must still be ≥ $18 to qualify for delivery (validated server-side before quote).
- **Welcome discount**: existing fix (`1eddeb8`) — only consumed on payment COMPLETED. Delivery orders that fail dispatch get refunded AND welcome discount restored.

## 9. Cup sticker / store-side printing

`printer-client` (shop-floor printer service) listens to Square order webhooks and prints cup stickers. Today it prints `#ORDER` + drink details for pickup orders.

**Change** (shipped from `printer-client` repo as part of Phase 4): when `fulfillment.type === "DELIVERY"`, append a footer line to the cup sticker:

```
→ DELIVERY · #ORDER
```

So shop staff doesn't call out the order number for collection (driver picks up via Uber app QR).

The `printer-client` repo change is small (one conditional in the ZPL builder) but lives in a separate codebase. Tracked here for completeness; full implementation detail belongs in that repo's commit.

## 10. Implementation phases

### Phase 0 — Business prerequisites (user, blocks Phase 4 only)
- Apply for Uber Direct merchant account (Mandy, ABN required)
- Create Google Cloud Console project + Places API key (referrer-restricted)
- Get Mandy's exact store lat/lng from Google Maps and add to env

### Phase 1 — Pricing libs + tests
- `delivery-fee.ts`, `delivery-hours.ts`, `places.ts`
- Vitest coverage: subtotal boundaries, hours boundaries, distance boundaries, holiday interaction
- Update `src/lib/constants.ts` with all new constants

### Phase 2 — Mock Uber client
- `uber-direct.ts` interface (OAuth, quote, createDelivery, parseWebhook)
- `UBER_DIRECT_MODE === "mock"` branch returns fixture data
- Unblocks UI dev without Uber account

### Phase 3 — UI / checkout
- `FulfillmentSelector`, `DeliveryAddressForm`, `DeliveryQuoteCard`
- `SummaryBlock` adds Delivery + Service Fee rows
- `CartDrawer` footer hint
- `/api/delivery/quote` route (using mock client)
- Place Order state machine + helper text
- cmux browser end-to-end test on local

### Phase 4 — Real Uber + webhook (after account approval)
- Switch `UBER_DIRECT_MODE=sandbox` → `production`
- `/api/orders` accepts `fulfillmentType=DELIVERY` + builds deliveryDetails + extra service charges
- `/api/payment` triggers `dispatchUberDelivery` with retry/refund logic
- `/api/webhooks/uber` handler with HMAC + idempotency + state mapping
- `printer-client` repo: footer line for delivery
- Order confirmation + Account page tracking link

### Phase 5 — Bridge & polish
- Cron job `/api/cron/uber-status-sync` every 5 min for stuck orders
- Mandy notification on dispatch failure (email)
- `NEXT_PUBLIC_DELIVERY_ENABLED=false` dark-launch flag
- Real E2E by Mandy: order from a 1 km address → verify dispatch → driver pickup → delivery
- Flip `DELIVERY_ENABLED=true`

## 11. Testing strategy

| Layer | Tool | Coverage |
|---|---|---|
| Unit | Vitest (already installed) | `delivery-fee` ($17.99/$18/$34.99/$35/$0/free-redeem), `delivery-hours` (10:59/11:00/21:30/21:31 Brisbane + UTC boundary cases), `places` Haversine (1km/9.99km/10km/10.01km) |
| API contract | Vitest + msw | `/api/delivery/quote` 4 returns (ok / out_of_zone / no_driver / 5xx); `/api/orders` accepts DELIVERY type and emits correct serviceCharges array; `/api/payment` retry logic on Uber 500 |
| Webhook | Vitest | HMAC verify (valid, invalid, missing); each Uber event → Square state mapping; idempotency (replay same event 2× → state unchanged on 2nd) |
| UI | cmux browser | Place Order disabled states; quote loading/error/success; address autocomplete dropdown; $18 threshold dynamic helper text |
| E2E manual | Uber sandbox + Mandy real account | quote → order → payment → dispatch → webhook → delivered chain |

## 12. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Uber Direct AU not in 4215 zone | Feature dead | Phase 0: confirm with Uber sales + sandbox quote test before code-complete |
| Uber account approval takes 1–4 weeks | Launch delayed | Phase 1–3 mocked; Phase 4 is the only blocked phase |
| Google Places API key abuse | Surprise GCP bill | Restrict by HTTP referrer + daily budget cap $5 in GCP console |
| GPS drift: Place Autocomplete returns address that's actually outside 10 km | Order accepted then dispatch refused | Server-side Haversine re-check in `/api/delivery/quote` (don't fully trust client) |
| Payment OK + Uber dispatch fails 3× | Customer charged then refunded | 7.2 handler; monitor failure rate via Sentry; threshold > 5% triggers alert |
| Loyalty double-grant via webhook | Customer gets 2 stars/drink | Explicit constraint: only payment path grants stars; webhook never touches loyalty |
| PH + Delivery + Service Fee customer sticker shock | Conversion drop on holidays | PH banner already disclosed; consider hiding delivery option on PH days if measured drop > 30% (not in v1) |
| Uber driver delays → drinks melt | Customer complaints | Wait-time estimator + tracking URL transparency (already in pickup); v1.1 might add prep delay logic |
| No dev verification of webhook signature pre-account | First production webhook fails | Use Uber's published HMAC docs + sandbox webhook signature test before flipping production gate |

## 13. Open questions (defer to spec review)

1. **Mandy notification channel**: email only for v1, or wire Twilio SMS now? Default: email. (Twilio may need separate account setup.)
2. **"Reorder for delivery" button on Account → Past Orders**: nice-to-have, deferred to v1.1.
3. **`NEXT_PUBLIC_DELIVERY_ENABLED` default**: spec says false (dark launch). Confirm we want this gate in production code.
4. **Apartment/unit field**: Uber Direct API field shape needs verification. If API takes a single `address` string, we'll concatenate ("Unit 5, 12 Smith St, Surfers Paradise QLD 4217"). If it takes structured fields, use them.
5. **App (RN) port**: explicitly out of scope this spec; will need its own spec after web is live.

## 14. Out of scope

- RN app delivery support (separate spec)
- DoorDash Drive / Menulog as fallback carriers
- Scheduled delivery
- Multi-store support
- Delivery-specific menu (e.g., hiding heat-sensitive items)
- Dynamic Uber-quote-based pricing (we're using flat $4.99 / FREE)
- Delivery-area-based promotions (e.g., free delivery to specific suburbs)
- POS-side delivery order routing changes (Square handles this natively)

---

**Awaiting user review before invoking writing-plans.**
