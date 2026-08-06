# ADR-0008 — 只有 Stan 做得了、或只有 Stan 做了才算数的事，才能 assign 给他

- 状态：Accepted
- 日期：2026-08-06
- 相关：#141（Protocol gap）；证据来自 #123、#135、#140

## 背景

Stan 的待办队列里混进了 agent 自己能做的事，结果是**真正卡他的事被稀释了**。

两个实例：

- **#123** 一个 issue 装了三件事：配 Vercel 环境变量（只有 Stan 能做）、跑 `006_staff_rosters.sql`（加性 DDL）、删 `RicksZhang/mandys-ops`（token 缺 `delete_repo`）。整个 issue 卡在最慢的一件上。
- **#135** 列了两个阻塞项：跑 `007_complaint_body_persisted.sql`，以及合并 #134。前者是加性 DDL，ADR-0004 明列可自主执行；后者按 ADR-0007「PR 作者 agent 在 CI 绿后自行 merge」也是自主的。#135 挂了一天并被催办两次，期间 #133 的修复在生产环境处于「已部署但失效」状态。

代价是具体的：投诉正文有一整天没有落库，而解锁它的操作不需要 Stan。

## 决策

**assign 给 Stan 的唯一理由是「agent 做不了，或者 agent 做了不算数」。** 三类：

| 类 | 含义 | 例 |
|---|---|---|
| **A. 凭证与外部账号** | agent 拿不到，或不该经手 | Vercel 环境变量、Apple Developer、Square Dashboard、Supabase Dashboard 的 Auth 设置、ACMA sender ID、repo 删除权限、passcode 的真机验证 |
| **B. 授权** | agent 做了不算数 | L1 协议变更的明确同意（见「协议自身的变更」）、ADR-0004 里「需 Stan 明确同意」那一栏的破坏性 DB 操作（`drop` / `alter column type` / `truncate` / 对真实数据的 `update` / `delete`） |
| **C. 商业决策** | 不是技术判断 | 定价、补偿方式、要不要做某个功能、优先级排序 |

**明确不属于以上三类、因此不得 assign 给 Stan：** 加性 migration（`add column` / `create table if not exists` / `create index` / `create or replace function`）、merge 自己的 PR（CI 绿即可）、找人 review（ADR-0007 已明说不强制第二 agent）、修 bug、写测试、重构。

### 能力属于环境，不属于任务

这是本 ADR 与 #141 原提案分歧的一点，也是它存在的主要理由。

#141 把「加性 migration」整类划为 agent 自主，依据是 ADR-0004。方向对，但**「agent 做得了」不是任务的固有属性，而是当前环境的属性**：

- 跑掉 007/008 的那条 lane（#140）走的是 `supabase link` + `db query --linked`，即 ADR-0004 的正式流程，它需要 `SUPABASE_ACCESS_TOKEN`。
- 同一时刻另一条 lane 的环境里没有这个 token：`supabase projects list` 返回 `LegacyPlatformAuthRequiredError`，`.env.local` 无 access token、无库密码，也没有可执行 DDL 的 RPC（`exec_sql` / `execute_sql` / `query` / `exec` / `run_sql` 全部 `PGRST202`）。

同一个 007，在一条 lane 里是自主任务，在另一条里做不了。一条写死「加性 migration 永不 assign」的规则，对前者正确，对后者错误。

顺带否掉一个具体推理：#141 以「你自己跑了列检查（service role）」推出「你具备跑该 migration 所需的一切」。**不成立**——service role 经 PostgREST 能 `select`，不能 `alter table`。不同凭证、不同能力。

因此规则是**先验证能力，再决定 assign**：

1. **assign 之前先探一次，把证据写进 issue body。** 「我觉得这得 Stan 来」不是判据；一条失败命令的输出才是。
2. **卡在凭证时，assign 的是凭证，不是任务。** 「把 `SUPABASE_ACCESS_TOKEN` 放进共享环境」是一次性的 A 类；「请帮我跑这条 migration」是每次都要重来的。前者把反复出现的阻塞变成一次性的。

## 操作细则

1. **一个 issue 只装一件需要 Stan 的事。** 能自己做的部分先做完再开 issue，不要捆绑（#123 是反例）。
2. **用 `--assignee real-stanyan`，不要只在 comment 里 cc。** cc 不产生 assignee，不进他的待办列表。
3. **body 第一句写明「为什么只有你能做」**，落到 A/B/C 哪一类，并附上第 1 条要求的证据。判据要写出来才能被反驳；写不出来通常意味着不该 assign。
4. **先做完自己那一半。**「我先问一下」不该是第一步。

催办不受限制——这条规矩生效后 Stan 的队列本来就短，催办才有意义。

## 后果

- 开 issue 前多一次探测。这是目的：它把「我猜我做不了」换成一行可核验的证据。
- 一部分现存 issue 需要瘦身。#123 的 migration 006 项已由 #140 完成，可当场移除。
- A 类里的凭证会逐渐从 Stan 手上搬进共享环境，Stan 的队列随时间变短而不是变长。

## 被否掉的选项

**「破坏性操作才 assign，其余一律自主」** —— 只看操作类型，忽略环境。上面 007 的双 lane 对照就是它的反例：agent 会按规则拒绝 assign 一件自己确实做不了的事，然后卡死。

**「拿不准就 assign 给 Stan」** —— 现状，正是本 ADR 要修的。它把判断成本转嫁给唯一的人类瓶颈。

## 修正记录

#141 正文有一处事实错误，一并记下以免后来者引用：文中称「#135 只有 cc，所以它在『assigned to me』里根本不存在」。实际 #135 的 `assignees` 是 `["real-stanyan"]`，assign 过。操作细则第 2 条本身仍然成立，但它不是 #135 的失败原因——#135 的失败原因是**装了两件 agent 自己能做的事**，与 assign 方式无关。
