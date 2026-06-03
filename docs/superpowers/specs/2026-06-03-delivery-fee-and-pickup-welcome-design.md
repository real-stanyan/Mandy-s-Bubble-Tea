# 配送费结构 + Welcome 折扣仅 Pickup · Design Spec

**Date:** 2026-06-03
**Status:** Approved (design)
**Scope:** Single implementation plan (pricing logic, server-authoritative)

## Problem

两项业务改动：
1. **配送费简化**：≤3km 免配送费；>3km 满 $50 免配送费，否则按距离分档收费。
2. **新人 Welcome 30%（前两杯）仅 Pickup 生效**：Delivery 单不享受、也不消耗新人额度。

不变：$12 起送门槛、5% Service Fee、10km 配送半径、配送营业时段、IG 10% 折扣、积分免费杯。

## Design

### 改动 1 — 配送费结构

`src/lib/constants.ts` 的 `DELIVERY` 重构 + `src/lib/delivery-fee.ts` 的 `deliveryFeeCents` 重写。

`deliveryFeeCents(drinksSubtotalCents, distanceKm)` 逻辑：
1. `distanceKm <= freeRadiusKm (3)` → `0n`（免费区，不看金额）
2. `drinksSubtotalCents >= freeAtSubtotalCents ($50/5000)` → `0n`（>3km 满 $50 免）
3. 否则按距离分档（沿用现有费）：
   - 3–4km → $4.99 / 4–6km → $6.99 / 6–8km → $8.99
   - 8–10km → fallback $12

`DELIVERY` 新形:
```
{
  freeRadiusKm: 3,
  freeAtSubtotalCents: 5000n,
  tiers: [ {maxKm:4,feeCents:499n}, {maxKm:6,feeCents:699n}, {maxKm:8,feeCents:899n} ],
  fallbackFeeCents: 1200n,
  maxKm: 10,
  minimumSubtotalCents: 1200n,   // 不变
  serviceFeeBps: 500n,           // 不变
  hoursOpen: 10.5, hoursClose: 22.5,  // 不变
}
```

- 统一免费门槛 $35→$50；原 0–2km $3.99 因 ≤3km 全免自然消失。
- `isDeliveryEligible` / `serviceFeeCents` 签名与行为不变。
- 调用方 `/api/delivery/quote` 与 `/api/orders` 不改调用，自动跟随。

### 改动 2 — Welcome 30% 仅 Pickup

单一真源纯函数（放 `src/lib/delivery-fee.ts` 旁或新 `src/lib/promo-eligibility.ts`）：
```
welcomeDiscountEligible(fulfillment: FulfillmentType): boolean
  => fulfillment === "PICKUP"
```

接入三处：
- `src/app/checkout/page.tsx`
  - `promoCoverage` 的 `welcomeK`：`fulfillment === "DELIVERY"` 时为 0（welcome 显示自动隐藏，UI 已 gated on `welcomeCount > 0`）。
  - 传 `/api/orders` 的 `applyWelcomeDiscount`：`welcomeDiscount.available && welcomeDiscountEligible(fulfillment)`。
- `src/app/api/orders/route.ts`（**服务端权威**）：`welcomeK` 在 `isDelivery` 时强制 0 → 不生成 welcome 折扣行 → metadata 无 `welcomeDiscountDrinksCovered` → `/api/payment` 不消耗新人额度。

IG 10% 与积分免费杯不受影响。「不叠加取最优」由现有 `pickPromoCups`（每杯单折扣分配）保证，不改。

## Testing (TDD)

`src/lib/delivery-fee.test.ts`（重写）:
- ≤3km（含 0/1/3.0km）任意金额 → $0
- 3.01km 未满$50 → $4.99；满$50 → $0
- 5km → $6.99；7km → $8.99；9km → $12（均未满$50）
- 任意 >3km 满$50 → $0
- `isDeliveryEligible` / `serviceFeeCents` 回归不变

`welcomeDiscountEligible`:
- PICKUP → true；DELIVERY → false

## Non-Goals (YAGNI)

- ❌ 不加「再加 $X 免配送费」促销文案（quote 卡已显示实际费/Free）
- ❌ 不动 IG 10% / 积分免费杯
- ❌ 起送门槛 / Service Fee / 半径 / 时段不变
