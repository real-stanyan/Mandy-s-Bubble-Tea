# Catalog — Menu & Items

## API Routes

### GET /api/catalog
Returns all items, categories, images from Square.
Cache with `next: { revalidate: 300 }` (5 min).

```typescript
// src/app/api/catalog/route.ts
import { NextResponse } from 'next/server'
import { catalogApi } from '@/lib/square'
import { serializeSquareResponse } from '@/lib/utils'

export async function GET() {
  const { result } = await catalogApi.listCatalog(undefined, 'ITEM,CATEGORY,IMAGE')
  const items = result.objects?.filter(o => o.type === 'ITEM') ?? []
  const categories = result.objects?.filter(o => o.type === 'CATEGORY') ?? []
  return NextResponse.json(serializeSquareResponse({ items, categories }))
}
```

### GET /api/catalog/[id]
Returns single item with variations.

## Pages

- `/menu` — category grid (7 categories as image cards)
- `/menu/[category]` — items in that category

## Category Slugs

| Display name | URL slug |
|---|---|
| MILKY | `milky` |
| FRUITY | `fruity` |
| SPECIAL MIX | `special-mix` |
| FRESH BREW | `fresh-brew` |
| FRUITY BLACK TEA | `fruity-black-tea` |
| FROZEN | `frozen` |
| CHEESE CREAM | `cheese-cream` |

## Key Components

- `CategoryGrid` — 2-col grid of category image cards
- `ItemCard` — product image, name, price, "Add to cart" button

## Types

```typescript
// src/types/square.ts
export interface CatalogItem {
  id: string
  type: string
  imageUrl?: string
  itemData?: {
    name?: string
    description?: string
    categories?: Array<{ id: string; name?: string }>
    variations?: CatalogItemVariation[]
  }
}

export interface CatalogItemVariation {
  id: string
  itemVariationData?: {
    name?: string
    priceMoney?: { amount?: bigint; currency?: string }
  }
}
```

## Notes

- Images come from Square Catalog — upload in Square Dashboard → Items
- Variations = different sizes/options for one item
- Default to first variation price if no selection UI needed
