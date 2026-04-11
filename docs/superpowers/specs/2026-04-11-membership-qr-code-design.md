# Account 页面会员 QR 码 · Design Spec

**Date:** 2026-04-11
**Status:** Draft (pending user review)
**Scope:** Single implementation plan (small, additive)

## Problem

顾客在 Mandy's Bubble Tea 结账时，店员需要把顾客加到这笔订单才能累积 loyalty 星星。目前流程是店员手动输入顾客手机号。我们想让顾客在 `/account` 页面出示一个 QR 码，店员用 Square Register 的内置扫码枪一扫即可识别。

## Key Findings (Square 官方支持)

Square Terminal / Register 原生支持"扫 QR/条形码识别顾客"流程，文档见 <https://squareup.com/help/us/en/article/7387-identify-customers-at-your-counter-with-qr-codes>。关键事实：

- 码的内容**必须是 Square Customer 的 `reference_id` 字段**，不是 `customer_id`。Square 拿扫到的字符串精确匹配 Customer Directory 的 `reference_id`。
- POS 侧要开 **Settings → Checkout → Customer Management → Scan customers using device camera**。
- 店员操作路径：**Review sale → Add a customer → 搜索框扫描图标 → 扫码**，顾客即加入订单。不是任意界面都能扫。
- 支持 CODE128 和 QR 两种格式，本 spec 选 QR。

## Non-Goals

- ❌ 不引入数据库或独立的 user 表（项目目前没有，Square 就是 source of truth）
- ❌ 不做 Apple Wallet/Google Wallet 集成（现有代码已有一个被 feature flag 门控的 banner，保持不动）
- ❌ 不做条码图片下载/打印/保存
- ❌ 不做"扫码可以 work"的功能性承诺——硬件验证是 ship 之后的事，不在 spec 验证范围内
- ❌ 不改 auth / sessionStorage / loyalty / orders / cart / checkout 任一现有流程

## Design

### 1. 架构与范围

纯增量改动：

- **后端补丁**：`src/app/api/customer/route.ts` 和 `src/app/api/customer/lookup/route.ts` 都加上"确保 `reference_id = phoneE164`"的逻辑
- **前端新组件**：`src/components/account/MemberQrCard.tsx`，在 `AccountDashboard` 里插入
- **新依赖**：`qrcode.react`（SVG 输出的 React QR 组件，无运行时依赖）

不新增：数据库、表、service、抽象层、新 route、新 env var。

### 2. `reference_id` 策略

**`reference_id = phoneE164`**（例如 `+61404978238`）

理由：

- 项目现有顾客唯一标识就是 E.164 手机号，天然契合
- 无需独立存储新 ID（项目无数据库）
- Square Dashboard 上 reference_id 一栏可读出手机号，店员 fallback 识别成本最低
- 手机号本身已在 Square Customer 的 phone 字段中，reference_id 里再出现一次不是新信息泄露

替代方案（UUID 作 reference_id）被排除：需要额外存储点，项目无处可存，绕一圈仍回到 Square 为 source of truth，纯增复杂度无收益。

### 3. 数据流

```
User submits phone
    ↓
POST /api/customer/lookup  (或 sign-up 走 POST /api/customer)
    ↓
Square customers.search({ filter: { phoneNumber: { exact: e164 } } })
    ↓
[NEW] if (existing && existing.referenceId !== e164):
          await customers.update({ customerId: existing.id, referenceId: e164 })
      (failure is logged, not fatal)
    ↓
[NEW for POST /api/customer create branch]:
      customers.create({ ..., referenceId: e164 })
    ↓
返回 { ok, customerId, phoneE164, ... }  (response shape 不变)
    ↓
Frontend: AccountDashboard 渲染 <MemberQrCard customerId phoneE164 />
    ↓
<QRCodeSVG value={phoneE164} size={160} />
显示 customerId.slice(-6).toUpperCase() 作为 "Member ID"
```

存储契约：reference_id 只存在 Square Customer 对象自身，不引入新 state、新 localStorage key、新表。

### 4. 后端补丁细节

#### `POST /api/customer/route.ts` (lookup-or-create)

现有逻辑：先 `customers.search()` 找已有 customer；找到就直接返回；找不到就 `customers.create()`。

补丁：

1. `customers.create()` 调用中追加 `referenceId: e164`
2. 搜索命中已有 customer 后、返回之前，插入：

   ```ts
   if (existing.referenceId !== e164) {
     try {
       await squareClient.customers.update({
         customerId: existing.id,
         referenceId: e164,
       });
     } catch (err) {
       console.warn("[customer] failed to sync referenceId", err);
       // non-fatal — continue
     }
   }
   ```

#### `POST /api/customer/lookup/route.ts` (lookup-only, no create)

现有逻辑：`customers.search()` → 找不到就 `{ found: false }`，找到就返回 customer 字段。

补丁：在"找到"分支里插入跟上面同样的 `referenceId` 同步逻辑（同样 try/catch 非致命）。

这两个 route 的补丁几乎一模一样。实施时可以考虑抽一个 `ensureReferenceId(customer, e164)` 小工具放进 `src/lib/square.ts`，但**只在第二次写时抽**——第一次先内联，避免过早抽象。

### 5. 前端组件规格

#### 文件：`src/components/account/MemberQrCard.tsx`

```tsx
"use client";
import { QRCodeSVG } from "qrcode.react";
import { BRAND } from "@/lib/constants";

export function MemberQrCard({
  customerId,
  phoneE164,
}: {
  customerId: string;
  phoneE164: string;
}) {
  if (!phoneE164 || !customerId) return null;
  const shortId = customerId.slice(-6).toUpperCase();

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-5 text-center shadow-sm sm:p-8">
      <h2
        className="text-xs font-bold uppercase tracking-widest"
        style={{ color: BRAND.primaryColor }}
      >
        Member Card
      </h2>
      <div className="mx-auto mt-5 inline-block rounded-xl bg-white p-3 ring-1 ring-black/5">
        <QRCodeSVG value={phoneE164} size={160} level="M" />
      </div>
      <p className="mt-4 font-mono text-lg tracking-widest text-zinc-900">
        #{shortId}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        Show at counter to earn stars
      </p>
    </section>
  );
}
```

设计要点：

- `size={160}`，移动端够大、不占满屏幕
- `level="M"` 纠错等级（默认平衡值，手机号内容短，冗余足够）
- 配色：卡片本体跟现有 section 一致的 `bg-white` + `rounded-2xl border border-black/10 shadow-sm`，标题用品牌色 `BRAND.primaryColor`
- Member ID：`font-mono tracking-widest`，`#ABC123` 风格，作为视觉身份标识
- 响应式：`p-5 sm:p-8` 跟随现有卡片 padding 节奏
- **注意**：Member ID 在 Square POS 里**无法用于搜索**（Square 只按 name/phone/email/reference_id 搜索，不按 customer_id 片段）。它的实际用途是：
  - 店员/顾客肉眼对账，"请报一下你卡上的 ID"
  - 顾客视觉上的"会员感"装饰
  - 若将来真的需要 POS 搜索 fallback，应走手机号不是 customer_id 后 6 位

#### 接入 `src/app/account/page.tsx`

在 `AccountDashboard` 内，现有 `Profile header card` 之后、`Loyalty card` 之前插入：

```tsx
<MemberQrCard customerId={data.customerId} phoneE164={data.phoneE164} />
```

`data.customerId` 和 `data.phoneE164` 都已经在 `AccountData` 里，无需新增 state 或 API 字段。

### 6. 依赖

```bash
npm install qrcode.react
```

- 包名：`qrcode.react`
- 版本：最新 stable（实施时由 `npm install` 决定）
- 体积：~10KB，纯 SVG 输出，无额外 runtime 依赖
- 被 Next.js 14 App Router "use client" 组件导入，无 SSR 问题（QRCodeSVG 是纯客户端渲染）

### 7. 错误处理

| 场景 | 行为 |
|------|------|
| Square `customers.update()` 同步 `referenceId` 失败 | `console.warn`，返回正常 lookup 结果。不阻塞用户登录。下次登录自动重试。 |
| 创建新 Customer 时 Square 报错 | 走现有的 502 错误分支，`error.message` 返回给前端 SignInForm 显示 |
| `data.customerId` 或 `data.phoneE164` 意外为空 | `MemberQrCard` 返回 `null`，不渲染卡片 |
| `qrcode.react` 导入失败 | 构建期 TypeScript 报错，实施时立即可见 |

### 8. 测试计划

项目目前没有自动化测试框架。手动验证步骤：

1. **本地 dev**：`npm run dev`，已有测试账号登录 → 看到 Member Card → 手机相机扫 QR → 确认内容 = `+61...`
2. **Sign-up 流程**：用一个未注册的手机号 + 姓名走注册 → 创建后 Member Card 正确显示
3. **Square Dashboard 验证**：打开对应 customer 的 profile → 确认 **Reference ID** 字段 = E.164 手机号
4. **幂等性**：登出已有账号后再次登录 → 检查 Square API 调用日志（或加临时 `console.log`），确认 `customers.update` 只在 `referenceId` 不一致时调用一次，已同步后不再调用
5. **降级**：手动在 `AccountData` 里把 `phoneE164` 置空 → 确认 `MemberQrCard` 不渲染且页面不崩溃
6. **硬件验证（POST-SHIP，不阻塞）**：Square Register 到位后，`Settings → Checkout → Customer Management` 开启扫码 → 结账流程点 Add a customer → 扫屏幕上的 QR → 确认顾客被加入订单。若 Register 内置 imager 不触发这个流程，回来评估是否换外接蓝牙 HID 扫码枪方案。

### 9. YAGNI 明确剔除

- ❌ 把 `ensureReferenceId` 抽成工具函数（等到第二处用到再抽）
- ❌ 前端展示 loading/error state（非网络操作，不需要）
- ❌ QR 码颜色定制/品牌色嵌入（默认黑白对扫码器最友好）
- ❌ 保存/下载/打印 QR 按钮
- ❌ Apple Wallet / Google Wallet 集成
- ❌ `reference_id` 冲突检测（两个账号手机号不会撞，已经是业务主键）
- ❌ "手动输入后 6 位查顾客"的任何 POS 侧支持（Square 不支持，显示是视觉用途）

## Open Questions

无。所有关键决策都已锁定：

- reference_id = E.164 手机号 ✓
- 码格式 = QR ✓
- fallback 显示 = customer_id 后 6 位（纯视觉，非 POS 搜索码）✓
- 不引入数据库 ✓
- 硬件验证延后 ✓

## Risks

1. **Square Register 内置扫码枪可能不触发"Add a customer"流程**。Square 文档在此处语言模糊（提到 camera 和 "barcode scanner on Android/iOS"，但未明确 Register 一代/二代内置 imager 的行为）。**缓解**：本 spec 范围内不承诺这一点 work；硬件到位后 5 秒可验证；若不 work，备选是外接 HID 蓝牙扫码枪——无需改代码，只改硬件采购。
2. **`customers.update` 幂等语义**。若多次 update 同一 `referenceId`，Square API 应是幂等的，但我们仍通过 "先比较再 update" 规避无谓调用。
3. **`reference_id` 长度限制**。Square 文档注明 reference_id 最大 100 字符；E.164 手机号最长约 15 字符，远低于限制。

## Implementation Order (indicative)

1. `npm install qrcode.react`
2. 改 `POST /api/customer/route.ts` 加 `referenceId` 同步
3. 改 `POST /api/customer/lookup/route.ts` 加 `referenceId` 同步
4. 写 `src/components/account/MemberQrCard.tsx`
5. 在 `src/app/account/page.tsx` 的 `AccountDashboard` 里接入
6. 手动验证步骤 1–5
7. Commit + push

硬件验证（步骤 6）推迟到 Square Register 到位后。
