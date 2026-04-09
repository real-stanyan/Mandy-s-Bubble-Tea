# Payment

## Square Web Payments SDK

```bash
npm install @square/web-payments-sdk-react
```

## PaymentForm Component

```tsx
// src/components/checkout/PaymentForm.tsx
// Uses <PaymentForm> + <CreditCard> from @square/web-payments-sdk-react
// Apple Pay is automatically included — no extra setup needed
// Style the card input using the style prop to match brand color #C43A10
```

## Payment API Route

```typescript
// POST /api/payment
// Body: { token, orderId, total (cents), phoneNumber? }

// Steps:
// 1. paymentsApi.createPayment({ sourceId: token, orderId, amountMoney, currency: 'AUD' })
// 2. If phoneNumber: look up loyalty account → accumulateLoyaltyPoints
// 3. Return { success: true, payment }

// Loyalty failure must NOT fail the payment — wrap in try/catch separately
```

## Apple Pay

- Works automatically via Square Web Payments SDK
- Requires HTTPS (Vercel handles this)
- Domain must be registered in Square Developer Dashboard → Web Payments SDK
- Customers using Apple Pay get loyalty card prompt after payment

## Idempotency

Always generate a fresh `crypto.randomUUID()` for each payment/order call.
Never reuse idempotency keys.

## Error States

- Card declined → show error below form, do not redirect
- Network error → show retry message
- Success → `clearCart()` then `router.push('/order-confirmation')`

## Currency

Always use `AUD`. Amount in BigInt cents.

```typescript
amountMoney: {
  amount: BigInt(totalCents),
  currency: 'AUD',
}
```
