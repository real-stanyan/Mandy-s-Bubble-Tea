# ADR-0006 — 降级路径必须上报，不能只写日志

- 状态：Accepted
- 日期：2026-07-28
- 相关：#86（三个 cron 静默失败 48 天）、#88、PR #91

## 背景

2026-07-28 发现 `CRON_SECRET` 从未配进 Vercel，三个生产 cron 自 2026-06-10 起每次调用都 500。持续 48 天。`delivery-auth-timeout` 停摆意味着未接单的配送订单的信用卡预授权一直挂着，loyalty stars 也没退。

失败**从来不是不可见的**：Vercel runtime log 里每 5 分钟一条。只是没人看日志。

同一轮排查发现 quote 有三条同构的路径：

| 路径 | 结果 | 当时的处理 |
|---|---|---|
| `orders.calculate` 失败 | 摘要标 `estimated: true`，可能差 1 分钱 | `console.error` |
| 目录 fetch 失败 | **所有折扣消失**，总价高于实际扣款 | `console.error` |
| tier 查询超时 | Gold/Diamond 丢 5% + 免小料 | `console.error` |

三条全都返回 200。

## 问题

Sentry 已接入，但 `instrumentation.ts` 只挂了 `captureRequestError` —— 它捕获**抛出**的错误。被 catch 吞掉再恢复的降级，产生一个健康的 200 和一行没人读的日志。

「fail-safe」设计（宁可少给折扣也不阻塞下单）本身是对的。错的是 fail-safe **之后什么都不做**。

## 决策

**任何「继续服务，但答案比应有的差」的路径，必须调用 `reportDegraded()`（`src/lib/degraded.ts`），不能只 `console.error`。**

```ts
reportDegraded("quote.square-calculate-failed", { lineCount: 3 }, err);
```

它同时写日志和 `Sentry.captureMessage`。三个约束：

- **warning 级，不是 error。** 请求成功了。对着恢复得了的 fallback 报警，只会训练所有人忽略报警 —— 这正是让 #86 活了 48 天的那种疲劳。
- **`event` 是稳定 slug，不是句子。** 它是 Sentry 的 grouping key：200 次同类降级要读成 1 个问题。变动的部分放 `detail`（进 `extra`，不参与分组）。
- **`detail` 只放运维事实**（id、计数、布尔），不放顾客数据。`sendDefaultPii: false` 是刻意的，别从这里绕开。

## 判据：什么算降级

「顾客拿到的东西，比一切正常时应该拿到的差 —— 而且顾客看不出来。」

算：折扣没上、价格算错、通知没发、后台任务没跑。
不算：顾客自己触发的拒绝（购物车里有下架商品、门店已打烊、重复提交）—— 那些有明确的 4xx 和面向顾客的文案，本来就是可见的。

边界情况按「顾客能不能自己发现」判。发现不了 = 上报。

## 后果

- Sentry 会多出一类 warning。这是目的，不是成本。
- 已接：quote 的两条 + `order-quote.ts` 的 tier 失败。
- 待接：#86 的 cron 缺 secret 路径（等 `CRON_SECRET` 配好，先让它能跑）；`order-quote.ts` 里 flash / app-download 的 catch 也是同一形状。

## 什么情况下该推翻

如果 Sentry 里这类 warning 多到没人看，说明判据太松，或者某条降级其实是常态（那它就不是降级，是设计）。届时收紧判据，或把那条路径改成不降级。
