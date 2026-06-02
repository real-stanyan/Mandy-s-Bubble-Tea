# 首页「选下单方式」弹窗 · Design Spec

**Date:** 2026-06-02
**Status:** Approved (design)
**Scope:** Single implementation plan (additive, client-only)

## Problem

已登录用户进入首页时，希望先用一个图文弹窗引导选择「自取 / 配送」，把选择作为进入 Checkout 的默认配送方式，减少用户到结账页才发现要切换的摩擦。

## Behavior

- **触发**：与现有 `LoyaltyPopup`（登出才显示）互斥。本弹窗在三条件全满足时显示：
  1. 已登录：`!loading && profile`（来自 `useAuth()`）
  2. 配送已开：`NEXT_PUBLIC_DELIVERY_ENABLED === "true"`（关了则无可选项，不显示）
  3. 本 session 未弹过
- **频率**：每个浏览器 session 只弹一次（`sessionStorage` 标记）。下个 session 仍会再弹。
- **内容**：顶部双场景海报图 + 下方一行两按钮：左 **Pick-up**、右 **Deliver**；右上角 X 关闭。
- **点 Pick-up / Deliver**：写入 session 偏好 + 标记已弹 + 关闭。**停在首页，不跳转。**
- **点 X / 点遮罩**：仅标记已弹 + 关闭，不写偏好（Checkout 走默认 PICKUP）。
- **Checkout 默认**：进入 Checkout 时读 session 偏好作为初值。**约束**：偏好为 DELIVERY 但购物车 drinks subtotal 未达 delivery 起送门槛（`isDeliveryEligible` / `DELIVERY.minimumSubtotalCents` = $12）时，跳回 PICKUP。配送 flag 关时也一律 PICKUP。

## Design

### 1. `src/lib/order-mode.ts`（新）

sessionStorage 隔离层 + 纯逻辑 helper，全部 `typeof window` 守 SSR。

- keys：`mandys:orderMode:preferred`、`mandys:orderMode:popupShown`
- `getPreferredFulfillment(): FulfillmentType | null`
- `setPreferredFulfillment(mode: FulfillmentType): void`
- `wasPopupShown(): boolean` / `markPopupShown(): void`
- `resolveInitialFulfillment(preferred, subtotalCents, deliveryEnabled): FulfillmentType`
  - 仅当 `preferred === "DELIVERY" && deliveryEnabled && isDeliveryEligible(subtotalCents)` 返回 `"DELIVERY"`，否则一律 `"PICKUP"`。

### 2. `src/components/home/OrderModePopup.tsx`（新）

`"use client"`。复用 `LoyaltyPopup` 的遮罩/卡片/X 视觉语言。

- gate：`!loading && profile && DELIVERY_ENABLED && !wasPopupShown()`（effect 内判定 `visible`）
- 顶部 `next/image` 海报（`/image/order-mode.webp`，圆角，铺满卡片宽度，保持比例）
- 下方两按钮 Pick-up / Deliver；右上角 X
- 交互见 Behavior

### 3. `src/app/page.tsx`

在现有 `<LoyaltyPopup />` 旁渲染 `<OrderModePopup />`。

### 4. `src/app/checkout/page.tsx`

购物车 zustand 异步 hydrate，**不在 `useState` 初值读偏好**（彼时 subtotal=0 会误判）。改用一次性 effect：cart `hydrated` 后用 `useRef` 守只跑一次，`setFulfillment(resolveInitialFulfillment(getPreferredFulfillment(), subtotal, DELIVERY_ENABLED))`。只设初值，之后用户手动 toggle 不被覆盖。

### 5. 资源

`~/Downloads/奶茶外卖双场景海报_清理版.webp` → `public/image/order-mode.webp`（2752×1536 webp）。

## Testing (TDD)

`src/lib/order-mode.test.ts`：
- `resolveInitialFulfillment` 全分支：pickup 偏好→pickup / delivery+够钱+开→delivery / delivery+不够钱→pickup / delivery+flag 关→pickup / 无偏好(null)→pickup
- sessionStorage get/set 往返 + `wasPopupShown`/`markPopupShown`

## Non-Goals (YAGNI)

- ❌ delivery 营业时间不作为初值 fallback 条件（只按金额；时间由 Checkout 现有 quote 报错处理）
- ❌ 不跨 session 记忆（每 session 重新问）
- ❌ 点按钮不跳转（停在首页）
- ❌ 不改 cart / 支付 / 现有 FulfillmentSelector 行为
