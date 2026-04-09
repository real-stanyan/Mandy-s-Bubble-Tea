# Account Page — /account

## Overview

No password login. Phone-number based lookup against Square API directly.
No Supabase or external auth needed.

## States

```
1. No phone saved        → show phone input form
2. Loading               → spinner
3. Account not found     → "Visit us in store" message + option to try again
4. Account found         → LoyaltyCard + OrderHistory + "Use different number" link
5. Error                 → error message + retry
```

## Session Persistence

```typescript
// On successful lookup:
sessionStorage.setItem('mandy_phone', phoneNumber)

// On mount:
const saved = sessionStorage.getItem('mandy_phone')
if (saved) fetchLoyalty(saved)

// On "Use different number":
sessionStorage.removeItem('mandy_phone')
setPhone('')
setLoyaltyAccount(null)
```

## Phone Input

- Placeholder: `04xx xxx xxx`
- Submit on Enter key or button click
- Format before API call: `formatAUPhone()` from `@/lib/utils`

## Page Layout (mobile-first, max-w-sm centered)

```
1. <LoyaltyCard />          ← stars, progress, reward status
2. "Use a different number" ← small text button
3. How it works box         ← cream bg #F5E6C8, 3 bullet points
4. Recent activity heading
5. <OrderHistory />         ← loyalty events list
```

## How It Works Box Content

```
⭐ Buy any drink = earn 1 star
🎁 9 stars = 1 free drink of your choice
📱 Show this page at the counter to redeem
```

## Navigation

Add "My Stars" link in navbar → `/account`
Show star count badge in navbar if phone is saved in sessionStorage.
