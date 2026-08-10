# Chatbox — 对话式点单助手

**日期**: 2026-08-10
**分支**: `feat/chatbox`
**状态**: 设计已确认，待实现

## 目标

站内浮窗聊天助手。客户用自然语言描述想喝什么（含糖度、冰量、尺寸、小料），助手推荐并生成一张商品卡片；客户点确认后进购物车，随时可让助手导向结账。

## 已确认的产品决策

| 决策 | 选择 | 影响 |
|---|---|---|
| 定制深度 | 全定制 — variation + 全部 modifier | tool schema 吃完整 modifier 树，需要严格校验 |
| LLM provider | DeepSeek（OpenAI 兼容协议） | 换 provider 只改 baseURL + model 名 |
| 入口位置 | 全站浮窗，挂 root layout | 对话状态需跨页面存活 |
| 加购确认 | 卡片确认后才写 cart | 误单当场可见，可口头改单重出卡 |

已知代价：Vercel 悉尼区 → DeepSeek 国内端点，往返延迟明显高于同区模型。用流式输出缓解首字等待。

## 架构

三层，边界清楚：

```
浏览器                          服务端                      DeepSeek
ChatDrawer                     /api/chat
  ├ 消息列表          POST →     ├ 压缩菜单 → system     →   tool call
  ├ DrinkProposalCard           ├ 校验 tool call ↺ 重试  ←   {ids}
  └ useCart.addLine()  ← 结构化 ┘ 从 catalog 算价
```

### 核心不变量

**LLM 只输出 id。** 商品名、价格、图片一律由服务端从 `getMenu()` 查出后填充。LLM 编造的价格进不了 UI，也进不了购物车。

对话状态全部在客户端（Zustand + sessionStorage），每次请求把完整历史 POST 上去。服务端**对话层** stateless — 无 session 表，不落任何消息内容。唯一的服务端写入是限流计数（见「限流」一节），与对话内容无关。

## 服务端

### `src/app/api/chat/route.ts`

薄适配层：取历史 → 组 system prompt → 调 DeepSeek → 校验 tool call → 返回结构化结果。业务逻辑全在 `src/lib/chat/` 下，可 vitest 直测。

### `src/lib/chat/menu-digest.ts`

把 `getMenu()` 的输出压成 LLM 可读的紧凑文本：

- 每个 item 一行：id、名字、描述、售罄标记
- 其下挂 variation 行（id、名字、价格）
- 其下挂 modifier list 行（名字、min/max 约束、各 modifier 的 id/名字/加价）

48KB 原始 JSON 压到约 3–5k token。走现有 `src/lib/api-cache.ts` 缓存；DeepSeek 的 context caching 让重复的菜单部分近乎免费。

### Tool schema

只有两个：

```ts
propose_drink: {
  itemId: string,
  variationId: string,
  modifiers: { modifierId: string, count: number }[],
  quantity: number,
  reason: string        // 说给客户听的一句话，为什么推这杯
}

go_checkout: {}         // 无参数；客户端跳 /checkout
```

### `src/lib/chat/validate-proposal.ts`

纯函数，输入 `(menu, proposal)`，输出 `{ ok: true, line } | { ok: false, errors[] }`。逐条查：

1. `itemId` 存在且未售罄；反查出它的 `categorySlug`（`getItemDetail()` 需要）
2. `variationId` 属于该 item、未售罄
3. 每个 `modifierId` 属于该 item 的某个 modifier list
4. 每个 required list（`minSelected > 0`）都选够了
5. `maxSelected` / `maxDistinct` / `maxPerKind` 未超 — 覆盖 TOPPING 那条「最多 3 种、每种最多 3 份」的规则
6. TOP 10 的 locked toppings 强制补上（`lockedToppingsFor()`）
7. Brulee / Cheese Cream 互斥禁用项未被选中（`isCheeseCreamItem` / `isOreoBruleeMilkTea`）

校验失败时，把结构化 error 列表塞回 messages 让 LLM 重试。**最多两轮**；第二轮仍失败则降级。

## 共享改造

目前「选项 → CartLine」的逻辑埋在 `src/components/menu/ItemOrderForm.tsx` 的 `handleAdd()` 里，与 React state 缠绕。chatbox 必须产出**结构完全相同**的 CartLine — 尤其是 `signatureFor()` 的分组签名，否则同一杯从 chat 加与从菜单加会变成购物车里的两行。

抽出共享模块：

```
src/lib/menu/build-cart-line.ts
  buildCartLine(item, variation, modifierLists, counts, lockedToppings)
    → Omit<CartLine, "id" | "quantity">
  buildDefaultCounts(modifierLists, lockedToppings) → CountMap
```

`ItemOrderForm` 与 chat 卡片都调用它。这是对现有代码的定向重构，不是新增并行分支 — 也是让 chat 加购行为能被 vitest 覆盖的前提。

## 客户端

```
src/components/chat/
  ChatBubble.tsx          悬浮按钮，挂 root layout
  ChatDrawer.tsx          抽屉外壳，复用 cart drawer 的动效语言
  MessageList.tsx
  DrinkProposalCard.tsx   图 + 尺寸/糖/冰/小料 + 服务端算的价 + 「加入购物车」
src/store/chat.ts         messages / isOpen / isThinking，sessionStorage 持久化
```

`DrinkProposalCard` 的确认按钮直接调 `useCart.addLine(buildCartLine(...))` — 与菜单页同一条路径。

**流式**：文字部分走 SSE 逐字输出；tool call 到齐后一次性下发 proposal。不流式的话，DeepSeek 的首字延迟会让客户以为卡死。

## 错误处理与降级

| 情况 | 行为 |
|---|---|
| LLM 两轮都校验不过 | 回「我没太确定，你直接看看菜单？」+ 跳 `/menu` 的按钮 |
| LLM 超时（>15s）/ 5xx | 同上，附关键词兜底匹配结果（纯本地，无网络） |
| 商品在客户确认前售罄 | 卡片确认时重查 catalog；售罄则禁用按钮并说明 |
| 限流命中 | 明确告知「聊天暂时忙」，不静默失败 |

关键词兜底匹配：对商品名做模糊匹配 + 「少糖 / 去冰」等规则解析。能力远弱于 LLM，但保证 chatbox 在 LLM 不可用时不变砖。

## 限流

公开 LLM 端点无限流 = 脚本可烧尽 DeepSeek 额度。仓库目前无任何限流基建（见 `src/app/api/promotions/app-download/claim/route.ts` 顶部 TODO）。

最小可用方案：

- Supabase 一张 `chat_rate_limit` 表，键 = IP hash + 小时桶。加性 migration，agent 可自主执行（AGENTS.md「Supabase migration 的 apply」一节）
- route 内硬限：单次对话历史最多 20 条消息、单条输入最多 500 字符、每 IP 每小时最多 30 条

不引入 Upstash Redis — 为单一功能新增一层基建属 over-engineering。

## 测试

全离线，进默认门禁（`npm test`）：

- `validate-proposal.test.ts` — 每条校验规则一个用例，含 TOP 10 locked toppings、TOPPING 3×3、brulee 互斥三个真实业务陷阱
- `build-cart-line.test.ts` — 同样输入下，`buildCartLine()` 与 `ItemOrderForm` 现有行为产出相同 CartLine（含 `signatureFor()` 签名一致）
- `menu-digest.test.ts` — fixture menu 进、快照出；断言 token 规模未失控
- `route.test.ts` — mock DeepSeek，覆盖「校验失败重试一轮后成功」与「两轮均失败降级」两条路径

DeepSeek 真实调用不进门禁。

## 环境变量

新增（server-only，禁 `NEXT_PUBLIC_` 前缀）：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`）
- `DEEPSEEK_MODEL`（默认 `deepseek-v4-pro`）

已对照官方文档核实（2026-08-10，api-docs.deepseek.com）：

- 在售模型只有 `deepseek-v4-flash` 与 `deepseek-v4-pro`。旧的 `deepseek-chat` / `deepseek-reasoner` 已不在列。
- tool calls 文档的示例用 `deepseek-v4-pro`；未明确 flash 的 tool 支持，故默认取 pro。
- OpenAI 兼容协议，可直接用 `openai` SDK 改 `baseURL`。
- strict JSON schema 处于 beta：需 `baseURL` 指向 `https://api.deepseek.com/beta`，每个 function 加 `"strict": true`，且所有 object 加 `"additionalProperties": false`。
- 定价（pro，每 1M input token）：cache hit $0.003625 / cache miss $0.435 — 命中缓存便宜约 120 倍，这是「菜单全量塞 system prompt」可行的前提。官方另注明近期将上调价格。

**strict 模式只保证参数形状，不保证 id 真实存在。** 校验器始终是权威，不因启用 strict 而放松。

需 Stan 在 Vercel 配置 production 值（属 AGENTS.md ADR-0008 的 A 类：凭证与外部账号）。

## 不做（YAGNI）

对话历史落库、跨 session 记忆、语音输入、bot 直接下单付款、个性化推荐算法。

## 未决

无。
