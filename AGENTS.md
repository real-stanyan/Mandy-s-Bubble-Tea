<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Mandy's Bubble Tea

自建 Next.js 电商站，取代 Square Online，全品牌化体验，后端走 Square API + Supabase。门店：34 Davenport St, Southport QLD 4215（Australia/Brisbane，AUD）。产品/模块细节见 `.claude/*.md` 与 `docs/`。

> This file is the single source of truth for ALL coding agents (Claude Code, Z Code, etc.).
> Rules live here and only here. Do not duplicate them elsewhere.
> `.claude/*.md` 是模块深挖文档（参考资料），不是第二份规则源。

## Tech stack

- **Next.js 14 App Router** + **TypeScript**（strict）；Tailwind + shadcn/ui；Zustand（购物车）
- **Square API**（Catalog / Orders / Payments / Loyalty / Customers）+ Square Web Payments SDK（Apple Pay）
- **Supabase**（auth + Postgres/PostgREST）——loyalty accrual、wallet、cup-label gallery、会员 tier 等
- **printer-client/**（Mac mini 常驻）——热敏小票 + 杯贴自动打印，SSH tunnel 回连
- 部署：**Vercel**（web）
- 门禁工具：**vitest**（离线回归）/ **eslint** / **tsc**。包管理 **npm**（非 pnpm）

## Hard rules

- **钱一律 cents + BigInt**：用 `toCents()` / `toDollars()`，禁浮点。返回任何 Square 数据前必过 `serializeSquareResponse()`——BigInt 会炸 JSON 序列化。
- **禁向客户端暴露 `SQUARE_ACCESS_TOKEN` / Supabase service key**：server-only。浏览器要用的 env 才加 `NEXT_PUBLIC_` 前缀。
- **Secrets 只走环境变量**（Vercel env / `.env.local`），禁硬编码、禁入 git。
- **vitest 默认套件（`npm test`）全离线**：单测走 mock，禁调真实 Square / Supabase。需真线的 contract / e2e 走各自独立配置（`vitest.contract.config.ts` 等，需 dev server），**不进默认门禁**。
- **API 路由一律在 `src/app/api/**`**；组件按 feature 放 `src/components/[feature]/`；框架无关的业务逻辑放 `src/lib/*`（可 vitest 直测）。
- **Tailwind only**：除品牌色外不写 inline style。品牌色 `#C43A10`（brick red）/ `#F5E6C8`（cream）。
- **一次性发放/入会别拿 `customerCreated` 当门**：Square `creation_source=MERGE/LOYALTY` 会在 `complete-signup` 跑之前就建好 customer 记录；用幂等 upsert，别 gate 在"是不是我建的"上。
- **补偿 bug 用未来 credit**（backfill `drinks_remaining` / 发新 promo），不走现金退款。

## Working agreement (multi-agent)

### On starting a shift（开工三件事）

1. `git log --oneline -10` — 看最近发生了什么
2. 查 GitHub Issues — **先找 open 的交接 issue**（上一棒的 Memory 在里面；读完关闭它 = 接手，见 ADR-0005。找不到 → 查最近关闭的 issue 有无「无下一棒」终局声明：有 = 合规终局收工（ADR-0009），正常开工；无 = 上一棒违规收工，开 Protocol gap issue 记录——两种情况都从 git log + open issues 重建上下文），然后看其他 open 任务和备注
3. 跑一遍门禁命令（见下）确认基线是绿的 — 红的先修或开 issue，不带病开工
4. **同 repo 有别的 agent 在场时**（session 启动会提示 peer）：动共享文件（`AGENTS.md`、`eslint.config.mjs`、config、迁移）前先 `/msg` 知会，避免撞。业务代码各做各的域。

### While working

- 小步 commit，message 写清 **why**，不只是 what
- 一个任务从头到尾一个 agent 做完；交接只发生在任务边界（issue 关闭 / PR 合并），不在任务中间
- 非 trivial 改动走分支 + PR；typo 级小改可直接进 main
- 架构性决策写 `docs/adr/`（一个决策一个文件，从 0012 起编号——0001~0011 已占用：0001~0010 是随 scaffold 带来的协议决策，0011 是本 repo 的 Gate 决策）
- 业务术语的定义查 `CONTEXT.md`；新术语出现时补进去

### Issue & PR 的角色

Issues 和 PR 是 agent 之间（以及 agent ↔ 人之间）带时间戳、append-only、不腐烂的会话载体。在本协议里有**三个不重叠的角色**——每个 issue/PR 都该能归入其中一类：

| 角色 | 什么时候用 | 什么时候关 |
|---|---|---|
| **Task**（任务） | 要做一件可执行的事 | 任务做完且门禁绿 |
| **Memory**（交接记忆） | 收工时在**交接 issue**（见 On ending a shift）留 comment，五项格式 | 下一棒读完并关闭交接 issue = 接手完成 |
| **Protocol gap**（协议缺口） | 撞上 repo 回答不了的问题（规则没写、歧义、边界模糊） | 缺口被补进 AGENTS.md / CONTEXT.md / ADR |

硬规则：

- **撞上 repo 回答不了的问题，必须开 issue（Protocol gap 类），不许 silent 判断。** 这是协议自我修复的唯一入口——缺口从"靠默契"变成"显性、可讨论、可关闭"。
- **Memory 类 comment 的最小格式**（ADR-0004）：① 做到哪 ② 卡在哪 ③ 下一步是什么 ④ 任务完成则关 issue ⑤ **判断依据 / 权衡**——本棒做了非既定决策时必填（选了什么、为什么、什么前提失效时该推翻）；没做决策就写「无」，不许省略。少一项都不算合格交接。
- **交接 = issue 关闭 / PR 合并的那一刻**，不是"我觉得讲清楚了"。没关 issue 就换人 = 任务中途换手，违反上一节。
- **PR 是 Task 的实施载体，不是独立角色**：PR 引用它实现的 Task issue，merge 时关 issue。PR review 中发现的新问题另开 issue，不在 PR 评论里堆。

> 为什么用 issue comment 而不是独立交接文件：理由见 `docs/adr/0003-issue-roles.md`。为什么 Memory 留在 open 交接 issue 而不是关闭的 Task issue：见 `docs/adr/0005-handoff-lives-in-an-open-issue.md`。issue tracker 用法见 `docs/agents/issue-tracker.md`，triage label 见 `docs/agents/triage-labels.md`。

### PR 处置（merge 规则）

四条规则（ADR-0007）：

- **merge 方式一律 merge commit**，不 squash、不 rebase：小步 commit 的 why 是协议资产（repo 是会话之间唯一的共享记忆），squash 等于删记忆；风格定死一种，历史才可预测。
- **谁 merge**：PR 作者 agent 在 CI 绿后自行 merge。协议改动按分级走（见「协议自身的变更」）：L1 等 Stan 同意，L2 自主。
- **review 不强制第二 agent**：轮班制下常态只有一棒在场，强制互审会阻塞在交接边界上。质量兜底 = CI 门禁 + Stan 事后否决权（revert + 重开 issue）。
- **不接手别人的 open PR**——那是任务中途换手（见 While working）。例外：交接 issue 明确移交，或 Stan 指示。

收工时 PR 还挂着 = 任务没做完：按 On ending a shift 第 3 条把进度写进 Task issue comment，PR 留 open。

### 协议自身的变更（改本文件的规则）

agent 可以修改 AGENTS.md，但**按改动内容分级**（ADR-0006）：

| 层级 | 内容 | 流程 |
|---|---|---|
| **L1 严格层** | Hard rules / Gate 命令 / Tech stack / 本节自身 | issue + ADR + PR，**且必须 Stan 在会话或 PR comment 中明确同意后 agent 才能 merge** |
| **L2 自治层** | Working agreement（除 Gate）/ 索引（Where to find things） | issue + ADR + PR，agent 可自主 merge |

「Gate 命令」的边界（ADR-0010 在本 repo 的映射）：Gate 一节的命令行本身 = L1。vitest / eslint / tsc 的测试与规则是代码不是门禁配置，日常增改随代码 PR 走；但**为了让门禁转绿而删除/弱化现有测试或放松 eslint 规则（而不是修代码）= 拆门禁，按 L1 对待**，需 Stan 同意。收紧断言/规则（新增测试、把 advisory 规则调回 error）= L2，随 PR 走。

通用规则（两层都适用）：

- **三件套缺一不可**：对应 issue（通常是 Protocol gap 类）+ ADR（记录决策与理由）+ 分支 PR（CI 绿才能 merge，merge 时关 issue）。
- **没有 issue + ADR 的协议改动是违规的**，应当 revert，无论属于哪一层。
- **协议变更比代码改动更重**：代码只在架构性决策时才要 ADR，协议变更一律要。
- **人保留事后否决权**：revert 对应 PR + 重开 issue，即撤销该变更——即便当时没拦住。

L1 的"明确同意"是 b-弱形态：Stan 在会话里说"同意"或在 PR comment 里写"同意"即可，agent 自己操作 merge 按钮。**不强制 GitHub 的 approve 按钮**——代价是 Stan 成为 L1 瓶颈，这个代价接受。

### Gate（门禁 — 收工前必须全绿）

```bash
npm test              # vitest 离线回归（零真实 API，不烧 token）
npm run lint          # eslint — 0 error 才算过（warning 不阻塞门禁）
npx tsc --noEmit      # 全项目类型检查（含测试文件）
```

CI（`.github/workflows/ci.yml`）跑同一套命令，红了不许 merge。CI 的 offline env（wallet 签名测试需要的 Apple/APNS crypto）从 GitHub Actions secret `TEST_ENV_FILE`（整份 `.env.test`）注入——一次性设置。真线 contract / e2e（`vitest.contract.config.ts` 等，需 dev server + 真环境）**不在门禁内**，按需手动跑。Gate 命令、eslint 作用域、advisory 规则处置、CI env 的理由见 `docs/adr/0011-gate-is-test-lint-tsc.md`。

### On ending a shift（收工规矩）

1. 门禁全绿
2. commit + push
3. 做完的 Task issue 照常关闭；做到一半的，进度写到该 issue 的 comment
4. **开下一棒的交接 issue**（Task 类，保持 open，ADR-0005）：body 写现状与下一步建议，本轮 Memory comment（五项格式，ADR-0004）留在这里。**这是下一棒唯一保证撞见的入口**——Memory 不再埋进随手关闭的 Task issue。**唯一例外——终局收工**（ADR-0009）：归档 / 确认无下一棒时可不开，但必须在最后关闭的 issue 里 comment 显式声明「无下一棒」+ 理由，沉默的终局不算终局

### Division of labor（可选，按需填）

本项目采用默认规则 = **Task issue 认领制**（ADR-0008 选项 2）：谁认领谁从头做到尾，任务不按 agent 特长路由。跑出分工经验后再填实。

## Where to find things

- `CONTEXT.md` — 领域词汇表（loyalty stars / tier / cup-label / promo 等术语）
- `docs/adr/` — 决策记录（0001~0010 协议决策随 scaffold 带入；0011 本 repo 的 Gate 决策；本项目自己的从 0012 起）
- `docs/agents/` — issue tracker（`issue-tracker.md`）、triage labels（`triage-labels.md`）、domain 文档消费约定（`domain.md`）
- `.claude/*.md` — 模块深挖文档：`square-api.md`（Square client / BigInt / 错误处理）、`catalog.md`、`cart-checkout.md`、`payment.md`、`loyalty.md`（stars / 9 星换免单）、`account.md`、`deployment.md`
- `docs/superpowers/plans/` + `specs/` — 历史功能计划与设计稿
- `src/lib/` — 框架无关业务逻辑（vitest 直测）：`square.ts`、`cup-label/`、`live-activity-webhook.ts`、`order-dedup.ts`、`wallet/` 等
- `src/app/api/**` — Next route handlers（薄适配）
- `src/store/cart.ts` — Zustand 购物车
- `printer-client/` — Mac mini 打印客户端（热敏小票 + 杯贴）
- `scripts/` — 运维/诊断脚本（`.tmp/` 是一次性、不 lint）
