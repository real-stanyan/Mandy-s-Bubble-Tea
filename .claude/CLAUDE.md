# Mandy's Bubble Tea — Claude Code 入口

**规则不在这里。** `AGENTS.md` 是所有 coding agent（Claude Code、Z Code…）的唯一事实源。
根 `CLAUDE.md` 只是 `@AGENTS.md` 空壳，本文件同理——**只指路，不复述**。

| 要找什么 | 去哪 |
|---|---|
| 协议、Hard rules、Tech stack、开工/收工仪式、Gate | `AGENTS.md` |
| 领域词汇（star / tier / cup-label / promo / Live Activity…） | `CONTEXT.md` |
| 本项目的架构决策 | `docs/adr/` |
| 协议决策（gearbox 管理，禁手改） | `docs/gearbox-adr/` |
| 目录导航（`src/lib`、API 路由、`printer-client/`…） | `AGENTS.md` → Where to find things |

## 模块深挖文档（参考资料，不是规则）

动对应模块前读一遍：

- `.claude/square-api.md` — Square client、BigInt、错误处理
- `.claude/catalog.md` — 菜单、品类、item card
- `.claude/cart-checkout.md` — 购物车状态、结账流程、建单
- `.claude/payment.md` — Square Web Payments SDK、Apple Pay
- `.claude/loyalty.md` — stars、loyalty card、进度条
- `.claude/account.md` — 账户页、手机号查询
- `.claude/deployment.md` — Vercel、env、域名

> 这些是参考资料，**不是第二份规则源**。与 `AGENTS.md` / `CONTEXT.md` 冲突时以后两者为准，
> 并回改这里——别两边各留一份。

## 为什么这份文件这么短

它曾经复制过一份 Tech stack、Key Rules、Project Structure、Loyalty System、Business Info。
到 2026-08 全都腐烂了：Next.js 写着 14（实际 16.2.3，直接顶掉 `AGENTS.md` 开篇的版本告警）、
字体写着 system sans-serif（实际 Shantell Sans + Fraunces）、API 路由列了 7 条（实际 24 条）。

副本会腐烂，引用不会（ADR-0045）。理由见 `docs/adr/0010`。
