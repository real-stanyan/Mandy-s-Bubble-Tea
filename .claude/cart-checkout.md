# Cart & Checkout

## Cart State (Zustand)

```typescript
// src/store/cart.ts
// Persisted to localStorage as 'mandys-cart'

interface CartItem {
  id: string           // catalog object id
  variationId: string  // variation id (used as unique key)
  name: string
  price: number        // in cents
  quantity: number
  imageUrl?: string
}

// Actions: addItem, removeItem, updateQuantity, clearCart
// Computed: total() → cents, itemCount()
```

## Checkout Flow

```
/cart → /checkout → /api/orders (create order) → PaymentForm → /api/payment → /order-confirmation
```

## Order Creation

```typescript
// POST /api/orders
// Body: { items: CartItem[], pickupTime?: string }
// Returns: Square Order object

// Uses fulfillment type: PICKUP
// scheduleType: ASAP (default) or SCHEDULED
```

## Checkout Page Logic

1. Show order summary
2. Collect phone number (optional — for loyalty)
3. Call `/api/orders` to create order → get `orderId`
4. Render `<CheckoutPaymentForm orderId={orderId} />`
5. On payment success → `clearCart()` → redirect to `/order-confirmation`

## Phone Number Field

- Optional but encouraged ("Enter for loyalty stars")
- Pass to `/api/payment` for loyalty accrual after payment
- Do not require it to proceed

## Order Confirmation Page

Show:
- Order number
- Items ordered
- Pickup location: 34 Davenport St, Southport QLD 4215
- Stars earned (if phone provided)
- Link to `/account` to check loyalty balance
