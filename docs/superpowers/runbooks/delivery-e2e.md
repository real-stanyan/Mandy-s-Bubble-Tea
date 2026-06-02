# Delivery E2E Manual Test Runbook

Purpose: validate the full delivery path before flipping `NEXT_PUBLIC_DELIVERY_ENABLED=true` in production.

## Prerequisites
- Uber Direct sandbox credentials in Vercel preview env
- A test Supabase user with phone +61 OTP-bypass set up
- Mandy or test address within 1 km of store

## Steps

### 1. Quote validation
- [ ] Sign in
- [ ] Add 1 drink (subtotal under $18) → checkout → verify Delivery toggle disabled with helper "Add $X to enable delivery"
- [ ] Add a second drink (subtotal ≥ $18) → Delivery enabled
- [ ] Click Delivery → enter test address → verify ETA appears
- [ ] Type address far away (e.g. Brisbane CBD ~70 km) → verify "Sorry, we don't deliver to that address"

### 2. Hours validation
- [ ] At 10:55 Brisbane: Delivery toggle should show closed message (or temporarily mock by changing system clock)
- [ ] At 11:00 Brisbane: Delivery enabled
- [ ] At 21:30 Brisbane: button should disable mid-session (60s re-check)

### 3. Place order + payment + dispatch
- [ ] Place delivery order with valid card ($18+)
- [ ] Verify Square Dashboard shows DELIVERY fulfillment + Delivery Fee + Service Fee + (PH if today is PH) + Card surcharge in service charges
- [ ] Verify order metadata has `delivery_address`, `delivery_lat/lng`, `delivery_quote_id`
- [ ] Verify Uber sandbox dashboard shows the dispatch
- [ ] Verify order metadata gets `uber_delivery_id` + `uber_tracking_url` written
- [ ] Verify customer-side order-confirmation page shows tracking link

### 4. Webhook reconciliation
- [ ] In Uber sandbox, advance the delivery to "delivered" status
- [ ] Verify webhook hits `/api/webhooks/uber` with valid signature
- [ ] Verify Square fulfillment.state flips to COMPLETED
- [ ] Verify Account → Past Orders shows COMPLETED + no Track link

### 5. Failure path
- [ ] In Uber sandbox, simulate driver cancellation
- [ ] Verify Square order CANCELED + customer refunded + Mandy notified (console log for v1)

### 6. Loyalty / welcome discount
- [ ] Use a fresh user with welcome discount → place delivery order → verify discount applied + consumed only on payment success
- [ ] Use a user with 9 stars → redeem reward → verify Service Fee + Delivery Fee STILL charged (only PH + card surcharge are skipped)

### 7. Production cutover
- [ ] After all above pass on Vercel preview deployment
- [ ] Set `UBER_DIRECT_MODE=production` + `NEXT_PUBLIC_DELIVERY_ENABLED=true` in production env
- [ ] Run one real $18+ delivery to Mandy's house with $0.01 card test → verify end-to-end
- [ ] Announce via web banner / social
