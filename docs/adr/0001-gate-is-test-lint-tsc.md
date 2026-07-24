# ADR-0011: 本 repo 的 Gate = vitest + eslint + tsc；lint 作用域与 advisory 规则处置

- Date: 2026-07-18
- Status: accepted

## Context

装多-agent 协作框架（照 `agents-md-scaffold`）时，scaffold 的 Gate 是一个文档结构自检脚本（`check-scaffold.js`），因为 scaffold 全是 markdown。本 repo 是**真实的 Next.js 应用**，Gate 必须跑真实的回归检查，不是结构自检。

落地时基线全红，需要先弄清楚"红在哪"才能定 Gate：

- `npm test`（vitest 离线回归）：2 个 test file 挂——都是**故意改行为后没更新的过期测试**（gallery 缩略图 `color.png`→`binarized.png`；live-activity 的 Android order-card mirror 现在在 LA-token gate 之前独立 fetch）。
- `tsc --noEmit`：9 个错，**全部在测试文件 + `vitest.contract.config.ts`**，产品 `src/` 零类型错。
- `eslint`：2083 个 error——其中约 1950 个是**噪音**：eslint 在扫构建产物（`.claude/worktrees/*/.next/`、`printer-client/dist/`）和一次性脚本（`scripts/.tmp/`）。真实源码错误约 130 个，且大头是测试文件的 `no-explicit-any` 和 react-compiler-era 的 advisory 规则。

## Decision

**Gate 三件套（L1）**：

```bash
npm test              # vitest 离线回归
npm run lint          # eslint，0 error 才算过（warning 不阻塞）
npx tsc --noEmit      # 全项目类型检查（含测试文件）
```

CI（`.github/workflows/ci.yml`）跑同一套。

**CI 的 offline env**：默认 vitest 套件里 wallet 签名测试（`src/lib/wallet/`）会从 `.env.test`（gitignored）读 Apple Pass / APNS 的 crypto 素材（`passkit-generator` 真签 `.pkpass`、`importPKCS8` 真建 ES256 JWT——没 mock，需真材料）。CI 从**单个 GitHub Actions secret `TEST_ENV_FILE`**（整份 `.env.test` 内容）在跑测试前 `echo` 回 `.env.test`。忠实（真 crypto）、安全（不进 git）、你一次性加 secret。未加 secret 前，CI 那 ~13 个 wallet 测试会红——这是明说接受的 bootstrap 状态，不是把它们排除出门禁（排除 = L1，需 Stan 同意）。

**eslint 作用域与规则分层**（写进 `eslint.config.mjs`）：

- **忽略构建产物 / worktree / 一次性脚本**：`.claude/**`、`**/.next/**`、`**/dist/**`、`scripts/.tmp/**`、`tmp/**`、`.vercel/**`、`.archviz/**`。这些是生成物，从来不该被 lint——不是放松门禁，是修正扫描范围。
- **测试文件**（`**/*.test.{ts,tsx}`、`tests/**`）：`no-explicit-any` 关。mock/fixture builder 合理用 `any`；测试的运行期类型安全由 tsc gate 兜底，不靠 lint。
- **Node 工具脚本**（`scripts/**`）：`no-explicit-any` + `no-require-imports` 关。它们跑在 Next bundle 外，故意用 CommonJS require + 松类型。
- **react-compiler advisory 规则降 `warn`**：`react-hooks/set-state-in-effect`、`react-hooks/purity`、`react-hooks/exhaustive-deps`。这些是性能/风格提示，不是 correctness。留作可见 warning，不阻塞门禁——否则会把一次不相关的组件 effect 重构塞进无关 PR。**correctness 规则仍是 error**：`react-hooks/rules-of-hooks`、源码里的 `no-explicit-any`、`no-unused-vars` 等。

**真实源码错误照常修，不靠配置绕过**：

- `rules-of-hooks` 的 11 个报错全是**误报**——`useDefaultFallback`（`enqueue.ts`）、`useV2`（`binarize.ts`）是服务端普通函数，只因名字带 "use"。改名 `applyDefaultFallback` / `isV2Enabled` 修正，而非关规则。
- `admin/prints/page.tsx` 的 2 个真 `any` 用具体类型替换。
- 9 个 tsc 测试类型错逐个修（含 1 处 `@ts-expect-error` 记录 vitest/config 的 `poolOptions` 类型滞后）。

## Consequences

- **换来的**：Gate 真绿、真有意义——真类型错、源码 `any`、hook 误用会当场拦下。
- **代价 / 边界**：
  - lint 的 advisory 降级是 **L2**（Working agreement 层，可自治调整）。要收紧回 error 属 L2，随 PR 走即可（ADR-0010：收紧断言零摩擦）。
  - 39 个 react-compiler warning 是既有技术债，Gate 不拦。要清需单独重构 ~10 个组件的 effect，属另一个任务，不混进框架落地 PR。
  - `no-explicit-any` 在测试/脚本关掉后，那两处域里若混进真该收紧的类型，lint 不会报——由 tsc + review 兜底。
- 若未来把 advisory 规则改回 error 或改 Gate 命令行本身，那是 L1 改动（ADR-0006 / ADR-0010），需 Stan 明确同意。
