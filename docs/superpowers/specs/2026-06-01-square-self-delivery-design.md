# Self-Delivery (Square POS, store staff) — Design Spec

**Status**: Approved (Stan, 2026-06-01)
**Supersedes**: `2026-04-25-delivery-design.md` (Uber Direct — abandoned)
**Branch**: `feat/delivery`
**Scope this round**: **Web only**. App (RN) port is a separate later round.

---

## 1. Why the pivot (Uber Direct → Square self-delivery)

AU courier-API landscape research concluded there is **no self-serve SMB courier API** in
AU we can ship on: Uber Direct gated behind a ROFR + account we never got, DoorDash Drive AU
production access globally restricted, Square Managed Delivery is record-only (doesn't
dispatch). Mandy's only viable path = **store staff deliver the orders themselves**.

## 2. The Square wall (verified, make-or-break)

Square **deliberately hides API-created `DELIVERY`-type fulfillment orders from the seller's
POS / Order Manager** unless you hold a formal Square delivery partnership (SMBs can't get one):

> "Any order you create with the DELIVERY fulfillment type is not available to a seller and
> not shown in the Square Point of Sale unless you have a formal partnership agreement with
> Square… does not appear in the Square Order Manager."
> — https://developer.squareup.com/docs/orders-api/fulfillments

`PICKUP`-type orders are **not** walled — that's why Mandy's existing online pickup orders show
in Register today (staff mark them PREPARED, which fires our `order.fulfillment.updated`
webhook → cup-label print + ready-push).

## 3. The working design — "pickup ticket, delivery stamp"

Create the Square order as a **`PICKUP` fulfillment** (so it surfaces in Register exactly like
every other online order staff already process), but stamp the delivery info into fields Square
POS **actually displays**:

- Fulfillment `note` → `🚚 DELIVERY · {full address} · {phone}{ · driverNote}`
- Order `ticketName` → keep the `OLxxx` number, prefixed with a delivery marker (e.g. `🚚 OLxxx`)
- Mandy's own DB/metadata still records the truth: `metadata.fulfillment_type = "DELIVERY"`,
  `delivery_address`, `delivery_lat/lng`. admin / forecast / fee accounting read this, unaffected.

**To Square it's a pickup with a note; to Mandy's system it's a delivery. Neither is lied to.**

Staff flow is unchanged: ticket pops in Register with the 🚚 address line → make drinks →
mark PREPARED → **drive it to the address**. Cup-label (ZD410) also prints the address as
paper backup (secondary; primary surface is the Register note).

## 4. What gets removed (Uber dispatch/tracking layer)

- `lib/uber-direct.ts` (+ test), `api/webhooks/uber/route.ts`,
  `api/cron/uber-status-sync/route.ts`, `api/orders/[orderId]/delivery-status/route.ts`
- `components/order/LiveDeliveryMap.tsx`, `LiveDeliveryStatus.tsx`
- payment route: `dispatchUberDeliveryWithRetry`, `refundFullPayment`, the dispatch block,
  `notifyMandyDispatchFailure` import + call, `deliveryTrackingUrl`/`deliveryRefunded` response.
  **⚠️ Correctness bug being fixed:** with no Uber configured the current code auto-refunds
  every delivery order on dispatch failure — removing the block stops that.
- `vercel.json`: drop the `uber-status-sync` cron.

## 5. What changes

- `/api/delivery/quote`: drop the Uber `quoteDelivery` call. Becomes a pure internal validator
  returning `{ ok, feeCents, serviceFeeCents }` after eligibility/hours/radius checks. No `quoteId`.
- `/api/orders`: `delivery.quoteId` no longer required; build PICKUP fulfillment + stamp (§3).
- `DeliveryQuoteCard.tsx`: show fee + "delivered by our team", drop Uber ETA.
- order-confirmation + account history: replace live tracking with static
  "Our team is delivering to {address}".

## 6. What stays (customer UX + gates)

- `FulfillmentSelector`, `DeliveryAddressForm` (Google Places), `delivery-fee.ts`,
  `delivery-hours.ts`, radius check, `NEXT_PUBLIC_DELIVERY_ENABLED` dark-launch gate.

## 7. Open pricing params (inherited from Uber spec — Stan to revisit, NOT blocking)

Current values kept as-is for now: fee $4.99 (free ≥$35), 8% service fee, $18 min, 10 km, 11:00–21:30.
For self-delivery the cost is staff time + petrol, not an Uber bill — radius and the 8% service
fee likely want revisiting. Flagged, not blocking the mechanism.

## 8. Non-goals

No auto-dispatch, no driver tracking/map, no "driver on the way" push, no App port this round,
no scheduled delivery (ASAP only), no third-party courier fallback.
