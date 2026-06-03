# 配送区按 Postcode 白名单 + 必填 Postcode · Design Spec

**Date:** 2026-06-03
**Status:** Approved (design)
**Scope:** Single implementation plan (delivery zone gate, server-authoritative)

## Problem

只有这 6 个 postcode 可配送：**4211, 4214, 4215, 4216, 4217, 4218**。Checkout 的 Delivery 流程必须让用户填写 postcode，且只有白名单内的 postcode 才能下单。

决策（已与用户确认）：
- **Postcode 替代 10km 半径**：删除 `isWithinDeliveryRadius` 配送区门，改用 postcode 白名单。配送费仍按直线距离分档（不变）。
- **Postcode 从选中地址自动带出 + 可编辑 + 必填**。

## Design

### 新模块 `src/lib/delivery-zone.ts`

- `DELIVERABLE_POSTCODES`（常量列表放 `src/lib/constants.ts`）= `["4211","4214","4215","4216","4217","4218"]`
- `isDeliverablePostcode(pc: string | null | undefined): boolean` — trim 后查白名单
- `extractPostcode(components): string | null` — 从 Google Places `address_components` 取 `types` 含 `postal_code` 的 `long_name`

### 表单 `src/components/checkout/DeliveryAddressForm.tsx`

- `DeliveryAddress` 类型加 `postcode: string`
- Places `fields` 加 `"address_components"`；`place_changed` 时 `extractPostcode` 预填 `postcode`（仍可手动改）
- 新增必填、可编辑 postcode 输入框（4 位 numeric）；非空且不在白名单 → 琥珀提示「We deliver to 4211, 4214–4218 only」

### `src/app/checkout/page.tsx`

- `deliveryAddress` 初值加 `postcode: ""`
- quote effect 前置门：`!isDeliverablePostcode(deliveryAddress.postcode)` → setQuoteState error（空→「Enter your delivery postcode」/ 非法→「Sorry, we don't deliver to that postcode」），不打服务端；合法才 fetch。`postcode` 进 fetch body + effect deps
- orders POST 的 `delivery` 对象加 `postcode`
- pay 门已 keyed on `quoteState.kind === "ok"` → postcode 不合法时 quote 非 ok → pay 自动禁用

### 服务端（权威）

- `src/app/api/delivery/quote/route.ts`：`QuoteBody` + `isValidBody` 加 `postcode: string`；**删 `isWithinDeliveryRadius` 检查**，改 `if (!isDeliverablePostcode(body.postcode)) → reason "out_of_zone"`；保留 `distanceKm`/`STORE_COORDS`（配送费仍需距离）
- `src/app/api/orders/route.ts`：`body.delivery` 加 `postcode`；删 radius 检查，改 postcode 检查（error「Postcode not in delivery zone」）；保留距离算费

`isWithinDeliveryRadius` helper 保留（其它地方若有引用不受影响），仅这两处停用。

## Testing (TDD)

`src/lib/__tests__/delivery-zone.test.ts`:
- `isDeliverablePostcode`：6 个全 true；`"4000"`/`""`/`null`/`undefined` false；`" 4215 "`（含空格）→ true
- `extractPostcode`：样本 components 含 postal_code → 提取；无 postal_code → null

## Non-Goals (YAGNI)

- ❌ 不删 `isWithinDeliveryRadius` helper
- ❌ 不改配送费 / welcome / 起送 / 时段
- ❌ 不交叉校验「手填 postcode 是否匹配 geocode 地址」（仅白名单 + 必填）
