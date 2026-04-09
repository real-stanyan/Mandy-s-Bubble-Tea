# Loyalty — Stars System

## Configuration (set in Square Dashboard — do not hardcode rules)

- 1 drink from any of 7 categories = **1 star**
- **9 stars** = Free Drink of Your Choice
- Configured under: Customers → Loyalty → Settings

## API Routes

### GET /api/loyalty/account?phone=04xx
Looks up loyalty account by AU phone number.
Returns `{ account }` or `{ account: null }` if not found.

```typescript
// Format phone before calling Square:
const formatted = phone.startsWith('+61') ? phone : `+61${phone.replace(/^0/, '')}`

loyaltyApi.searchLoyaltyAccounts({
  query: { mappings: [{ phoneNumber: formatted }] }
})
```

Key fields from `account`:
- `account.balance` → current stars
- `account.lifetimePoints` → total ever earned
- `account.availableRewards` → redeemable rewards
- `account.enrolledAt` → join date

### GET /api/loyalty/events?accountId=xxx
Returns last 20 loyalty events for history display.

Event types:
- `ACCUMULATE_POINTS` → stars earned (show `+N`)
- `REDEEM_REWARD` → reward redeemed (show 🎁)

### POST /api/loyalty/accrue (called internally from /api/payment)
Not a public route — called after successful payment.

## Components

### LoyaltyCard
- Background: `#C43A10`
- Shows: current stars (large number), progress bar, next reward message
- If `availableRewards.length > 0`: show "🎉 You have a free drink reward!"

### StarsProgress
- 9 segments, filled white = earned, white/30 = remaining
- `current = balance % 9`

## Account Lookup Flow

```
User inputs phone → GET /api/loyalty/account
  → found: show LoyaltyCard + OrderHistory
  → not found: "Visit us in store to start earning stars!"
```

Save phone to `sessionStorage` key `mandy_phone` so user doesn't re-enter on refresh.

## Accrual After Payment

Accrual happens in `/api/payment` after successful charge:
1. Look up customer by phone → get `customerId`
2. Look up loyalty account by `customerId`
3. Call `accumulateLoyaltyPoints({ orderId })`
4. Wrap entirely in try/catch — loyalty failure must not affect payment success
