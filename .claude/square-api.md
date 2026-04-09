# Square API Setup

## Client Initialization

```typescript
// src/lib/square.ts
import { Client, Environment } from 'square'

export const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN!,
  environment: Environment.Production,
})

export const catalogApi = squareClient.catalogApi
export const ordersApi = squareClient.ordersApi
export const paymentsApi = squareClient.paymentsApi
export const loyaltyApi = squareClient.loyaltyApi
export const customersApi = squareClient.customersApi
```

## Environment Variables

```bash
# Server only
SQUARE_ACCESS_TOKEN=
SQUARE_LOCATION_ID=

# Client (browser)
NEXT_PUBLIC_SQUARE_APP_ID=
NEXT_PUBLIC_SQUARE_LOCATION_ID=
NEXT_PUBLIC_SQUARE_ENVIRONMENT=production
NEXT_PUBLIC_SITE_URL=https://mandybubbletea.com
```

## BigInt Handling

Square SDK uses BigInt for money — always serialize before returning from API routes:

```typescript
// src/lib/utils.ts
export function serializeSquareResponse(data: unknown): unknown {
  return JSON.parse(
    JSON.stringify(data, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  )
}

export const toCents = (dollars: number): bigint => BigInt(Math.round(dollars * 100))
export const toDollars = (cents: bigint | number): number => Number(cents) / 100
export const formatPrice = (cents: bigint | number): string =>
  `A$${toDollars(cents).toFixed(2)}`
```

## Error Handling

```typescript
export async function safeSquareCall<T>(
  fn: () => Promise<{ result: T }>
): Promise<{ data: T | null; error: string | null }> {
  try {
    const { result } = await fn()
    return { data: result, error: null }
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'errors' in error) {
      const e = error as { errors: Array<{ detail: string }> }
      return { data: null, error: e.errors[0]?.detail ?? 'Unknown error' }
    }
    return { data: null, error: 'Something went wrong' }
  }
}
```

## Constants

```typescript
// src/lib/constants.ts
export const LOCATION_ID = process.env.SQUARE_LOCATION_ID!

export const BRAND = {
  name: "Mandy's Bubble Tea",
  address: '34 Davenport St, Southport QLD 4215',
  phone: '0404 978 238',
  color: '#C43A10',
  accentColor: '#F5E6C8',
} as const

export const LOYALTY = {
  starsForReward: 9,
  rewardName: 'Free Drink of Your Choice',
} as const

export const MENU_CATEGORIES = [
  'MILKY', 'FRUITY', 'SPECIAL MIX',
  'FRESH BREW', 'FRUITY BLACK TEA', 'FROZEN', 'CHEESE CREAM',
] as const
```

## Phone Number Formatting (AU)

Always format AU phone numbers to E.164 before passing to Square:

```typescript
export function formatAUPhone(phone: string): string {
  return phone.startsWith('+61')
    ? phone
    : `+61${phone.replace(/^0/, '')}`
}
```
