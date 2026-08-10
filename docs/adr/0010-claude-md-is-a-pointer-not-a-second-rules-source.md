# ADR-0010 — `.claude/CLAUDE.md` 收敛成指针，不做第二份规则源

- 状态：Accepted
- 日期：2026-08-10
- 相关：#182（Task）、#64（提出该遗留的 PR）

## 背景

`AGENTS.md` 开篇就立了两条：

> This file is the single source of truth for ALL coding agents.
> `.claude/*.md` 是模块深挖文档（参考资料），不是第二份规则源。

`CONTEXT.md` 的 Key invariants 又锁了一条：

> `AGENTS.md` 永远是唯一规则源；根 `CLAUDE.md` 永远只是 `@AGENTS.md` 空壳

但这条不变量只点名了**根** `CLAUDE.md`。`.claude/CLAUDE.md` 从未被点名，而 Claude Code
会把它当作 project instructions **自动加载**——于是它事实上就是第二份规则源，只是没人这么叫它。

#64（多-agent 协作框架落地）当时就发现了重叠，并在 body 里记为「已知后续」，建议后续开 Task
issue 收敛。这件事拖到了 2026-08。

## 问题

拖的这段时间里，问题从「重叠」变成了「主动误导」。2026-08-10 逐条核对：

| `.claude/CLAUDE.md` 写的 | 实际 |
|---|---|
| Framework: **Next.js 14** | `package.json` → **16.2.3** |
| Font: **System sans-serif** | `src/app/layout.tsx` → Shantell Sans + Fraunces + Inter + JetBrains Mono（#177） |
| Project Structure：**7** 条 API 路由、有 `cart/page.tsx` | `src/app/api/` 实际 **24** 个目录；顶层无 `cart/` |
| 一节 "Key Rules" | `AGENTS.md` Hard rules 的过期副本 |
| 一节 "Loyalty System" | `CONTEXT.md` 词表的副本 |

第一行最要命：`AGENTS.md` 的第一句话是「This is NOT the Next.js you know — 读
`node_modules/next/dist/docs/` 再写代码」，而同样自动加载的 `.claude/CLAUDE.md` 紧接着
断言「Next.js 14」。两份都进 context，**后者把前者的告警顶掉了**。一个骗人的副本比没有副本更糟：
读者以为自己已经知道了，于是不去看源。

这也不是「谁不小心」。和 ADR-0007 的索引腐烂是同一个机制：每改一次技术栈/结构/规则，就必须
记得同步一份没有任何东西强制关联的副本——门禁不查，CI 不查，reviewer 不会注意到。**忘记是默认
结果，记得才是例外。**

## 决策

**`.claude/CLAUDE.md` 只指路，不复述。** 它保留两样东西：

1. 一张「要找什么 → 去哪」的路由表（`AGENTS.md` / `CONTEXT.md` / `docs/adr/` / `docs/gearbox-adr/`）
2. `.claude/*.md` 模块深挖文档清单，并明写它们是参考资料、冲突时以 `AGENTS.md` / `CONTEXT.md` 为准

删掉的是 Tech stack、Key Rules、Project Structure、Loyalty System、Business Info——
每一条都在 `AGENTS.md` 或 `CONTEXT.md` 里有源。

判据沿用 ADR-0007：**协议/入口文件里不写任何「别处已有源、且会随代码演进而变化」的东西。**
稳定的语义（这个文件是什么、去哪找什么）继续写。副本会腐烂，引用不会（ADR-0045）。

同时把 `CONTEXT.md` 的 Key invariant 从只点名根 `CLAUDE.md` 扩到两份：

> `AGENTS.md` 永远是唯一规则源；根 `CLAUDE.md` 永远只是 `@AGENTS.md` 空壳，
> `.claude/CLAUDE.md` 永远只是指路表——两者都不复述规则（ADR-0010）

**这一条是本决策的关键部分，不是顺手改。** 只清空文件而不锁不变量，等于把同一个坑原样留着：
下一个想「给 Claude 补点项目速览」的人会照样往里写，两个月后再腐烂一次。清空是治标，
补不变量才是治本。

### 顺带删掉、需要 Stan 确认的两条

- `## Brand` 的 Tone（"Friendly, casual, bubble tea shop vibe"）——品牌色在 `AGENTS.md`
  Hard rules 里有源，Tone 没有源；#177 设计 token 化之后它多半也已过期。
- `## System` 指向 `~/system/DEV_QUEUE.md`——机器本地路径，不在 repo 里，agent 无法核验。

两条都不是规则，删掉不影响任何门禁；若仍需要，正确的落点是 `AGENTS.md`（Tone）或 Stan 本地
配置（DEV_QUEUE），不是这份自动加载的入口文件。

## 分级

**L1。** 按 ADR-0012「机制引用优先」：删掉的正是 Hard rules 的副本，新文件也点名 Hard rules /
Tech stack。虽然本 ADR 只是**执行** `AGENTS.md` 已经立好的法（「`.claude/*.md` 不是第二份规则源」）、
没有新增或更改任何规则语义，但 ADR-0012 要求「拿不准 → 默认 L1，不许自授豁免」。故按 L1 走：
issue + ADR + PR，且需 Stan 明确同意后才 merge。

## 后果

- 想知道技术栈/结构/规则，得看 `AGENTS.md` 或直接看代码。这是目的：那里的答案永远是对的。
- 少一个必然会被遗忘的同步义务。
- 代价：Claude Code 的自动加载 context 里不再有一份「一眼看全」的项目速览。可接受——它本来
  也做不到，只是看起来像做到了。
- 不解决 `.claude/PROJECT_STATUS.md`（206 行、`_Last updated: 2026-04-09_`、还写着
  "not yet deployed"）。它同属腐烂快照，但不是规则源、也不被自动加载，另开任务处理。

## 什么情况下该推翻

如果将来 Claude Code 的加载机制变成「只读 `.claude/CLAUDE.md`、不读 `AGENTS.md`」，那这份
文件就必须重新承载内容。届时正确的做法是让它**生成**自 `AGENTS.md`（或直接 `@AGENTS.md`
引用），而不是把手写副本加回来。
