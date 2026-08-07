# mandys-selfheal 阶段 1（管线）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成一条把 Mandy 四路生产日志汇聚、脱敏、指纹去重、按门槛告警的管线，全程不修改任何代码、不执行任何补救动作。

**Architecture:** 新建独立 repo `mandys-selfheal`，npm workspaces 三包。`core` 是零依赖纯函数（脱敏 / 指纹 / 分类），Node 与 Workers 两个运行时共用，vitest 直测。`collector` 是 Cloudflare Worker，D1 存 incident、KV 存 kill switch，暴露两个 ingest 端点。`agent` 是 Mac mini 上的 launchd 常驻进程，tail 本地日志上报。`poller` 是 GitHub Actions cron，拉 Supabase Logs API 回灌同一入口。

**Tech Stack:** TypeScript strict / npm workspaces（**非 pnpm**）/ vitest / Cloudflare Workers + D1 + KV / wrangler 4 / GitHub Actions

**上游 spec:** `docs/superpowers/specs/2026-08-07-mandy-selfheal-design.md`（在 `mandys_bubble_tea` repo）

## Global Constraints

- 包管理用 **npm**，不用 pnpm、不用 yarn
- TypeScript **strict: true**，所有包共用根 `tsconfig.base.json`
- 门禁三件套，收工必须全绿：`npm test` / `npm run lint` / `npx tsc --noEmit`
- 默认测试套件**全离线**：禁调真实 DeepSeek / Supabase / Cloudflare / Telegram。需真线的走独立配置，不进门禁
- **Secrets 只走环境变量与 `wrangler secret`**，禁硬编码、禁入 git
- `core` 包**零运行时依赖**，且禁 import `node:*`——它要在 Workers 运行时里跑
- 时间一律 epoch 毫秒（`number`），禁传 `Date` 对象跨包
- 所有新建 repo 用 `gearbox-install` 初始化（用户全局规则，ADR-0022）

## 本阶段明确不做（Out of scope）

- **不调 DeepSeek**，不生成补丁，不开 PR，不 merge，不部署，不回滚——全部属阶段 2/3
- **不执行 L0 runbook**（重启打印进程、重连 tunnel）。上游 spec 把 L0 归在 agent 名下，但阶段 1 的验收标准是「只收集不修复」，执行补救动作与之冲突。agent 本阶段只 tail 与上报；L0 作为阶段 1.5 单独出计划，前提是去重准确率已验证
- **不接 iOS App**，不引入 Sentry（spec 已裁掉）
- 不做 incident 状态机迁移。D1 的 `state` 列建好，阶段 1 只写入 `new`；迁移逻辑随 healer 在阶段 2 落地

## File Structure

```
~/Github/mandys-selfheal/
├── AGENTS.md CLAUDE.md CONTEXT.md docs/  (gearbox-install 生成)
├── package.json                          workspaces 根，门禁脚本
├── tsconfig.base.json                    strict 基线
├── eslint.config.mjs
├── .github/workflows/ci.yml              门禁三件套
├── .github/workflows/poller.yml          Supabase 拉取 cron
└── packages/
    ├── core/                             零依赖纯函数，两运行时共用
    │   ├── src/types.ts                  RawLogEvent / Incident / Service
    │   ├── src/redact.ts                 脱敏
    │   ├── src/fingerprint.ts            归一化 + 指纹
    │   ├── src/classify.ts               钱路径判定 + 触发门槛
    │   └── src/index.ts                  桶文件
    ├── collector/                        Cloudflare Worker
    │   ├── src/index.ts                  路由
    │   ├── src/switch.ts                 KV kill switch
    │   ├── src/incidents.ts              D1 读写 + 窗口累加
    │   ├── src/verify.ts                 Vercel 签名 + agent HMAC
    │   ├── src/vercel.ts                 Vercel drain payload → RawLogEvent[]
    │   ├── src/notify.ts                 Telegram
    │   ├── migrations/0001_incidents.sql
    │   ├── wrangler.jsonc
    │   └── vitest.config.ts              workers pool
    ├── agent/                            Mac mini launchd
    │   ├── src/index.ts                  主循环
    │   ├── src/tail.ts                   增量读日志文件
    │   ├── src/parse.ts                  printer-client 日志行 → RawLogEvent
    │   ├── src/ship.ts                   上报 + 失败落盘重试
    │   ├── src/config.ts                 env
    │   └── deploy/com.mandysbubbletea.selfheal-agent.plist
    └── poller/
        └── src/index.ts                  Supabase Logs API → collector
```

**边界理由：** `core` 承载全部可测的判定逻辑且零依赖，使指纹与脱敏这两处最容易出错的地方能被纯函数测试穷举，且 Worker 与 Node 两侧行为保证一致。`collector` 只做 IO 与编排。`agent` 与 `poller` 是两个薄适配器，各自只负责把一种源变成 `RawLogEvent[]` 再 POST。

---

### Task 1: repo 骨架与门禁

**Files:**
- Create: `~/Github/mandys-selfheal/`（gearbox 生成 + 下列手写文件）
- Create: `package.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.github/workflows/ci.yml`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`

**Interfaces:**
- Consumes: 无
- Produces: 可运行的 `npm test` / `npm run lint` / `npx tsc --noEmit`；workspace 名 `@selfheal/core`

- [ ] **Step 1: 用 gearbox 初始化骨架**

```bash
gearbox-install ~/Github/mandys-selfheal --maintainer stanyan --gate "npm test && npm run lint && npx tsc --noEmit"
cd ~/Github/mandys-selfheal && git init 2>/dev/null; git status -sb
```

- [ ] **Step 2: 写根 package.json**

```json
{
  "name": "mandys-selfheal",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22",
    "eslint": "^9",
    "tsx": "^4.19",
    "typescript": "^5.6",
    "typescript-eslint": "^8",
    "vitest": "^2"
  }
}
```

**为什么用 `tsx` 而不是 Node 的 `--experimental-strip-types`：** 原生类型剥离不做 TS 的 `./x.js` → `./x.ts` 重映射，而本仓库按 TS 惯例在相对 import 上写 `.js` 后缀。`tsx` 会重映射，且 `printer-client` 已在同一台 Mac mini 上用它，运行时行为是验证过的。

- [ ] **Step 3: 写 tsconfig.base.json 与根 tsconfig.json**

`tsconfig.base.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  }
}
```

`tsconfig.json`：

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "types": ["node", "@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]
  },
  "include": ["packages/*/src/**/*.ts", "packages/*/test/**/*.ts"]
}
```

**为什么根配置要同时挂 node 与 Cloudflare 两套类型：** 门禁的 `npx tsc --noEmit` 从根跑一次，覆盖全部 workspace。collector 用 Workers 全局（`D1Database` / `KVNamespace` / `ExportedHandler`）与 `cloudflare:test` 模块，agent 与 poller 用 `node:*`——根配置只挂一套，另一套必然报 `Cannot find name`。各包自己的 `tsconfig.json` 仍各挂各的 `types`，单独检查某个包时隔离照旧；根配置的宽松只影响这一次全量检查。

> 这两个 devDependency 在 Task 5 才装。Task 1 的根 `tsc` 只覆盖 `core`，此时 `types` 里列着尚未安装的包名会报错——**Task 1 先只写 `"types": ["node"]`，Task 5 装完 Cloudflare 依赖后再补齐另外两项。**

- [ ] **Step 4: 写 eslint.config.mjs**

```js
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.wrangler/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
```

- [ ] **Step 5: 建 core 包**

`packages/core/package.json`：

```json
{
  "name": "@selfheal/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run" }
}
```

`packages/core/tsconfig.json`：

```json
{ "extends": "../../tsconfig.base.json", "include": ["src/**/*.ts", "test/**/*.ts"] }
```

`packages/core/src/index.ts`：

```ts
export const VERSION = "0.1.0";
```

- [ ] **Step 6: 装依赖并跑门禁，确认三件套全绿**

```bash
cd ~/Github/mandys-selfheal && npm install && npm test && npm run lint && npx tsc --noEmit
```

预期：`test` 因 core 无测试文件而通过（vitest 无用例退出码 0 需加 `--passWithNoTests`，若报错则把 core 的 test 脚本改成 `vitest run --passWithNoTests`），`lint` 与 `tsc` 无输出。

- [ ] **Step 7: 写 CI**

`.github/workflows/ci.yml`：

```yaml
name: ci
on: [push, pull_request]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "npm" }
      - run: npm ci
      - run: npm test
      - run: npm run lint
      - run: npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
cd ~/Github/mandys-selfheal
git add -A
git commit -m "chore: scaffold mandys-selfheal with npm workspaces and the three-command gate

Gate matches the main repo's (test/lint/tsc) so an agent moving between
the two does not have to relearn what green means."
```

---

### Task 2: core — 类型与脱敏

日志会被发往第三方 API，脱敏是数据出境前的最后一道闸，必须在 `core` 里做且被穷举测试。

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/redact.ts`
- Create: `packages/core/test/redact.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type Service = "web" | "admin" | "printer" | "printer-cup-label" | "supabase" | "tunnel"`
  - `interface RawLogEvent { service: Service; message: string; level: "error" | "warn"; timestamp: number; file?: string; requestId?: string }`
  - `function redact(input: string): string`

- [ ] **Step 1: 写 types.ts**

```ts
export type Service =
  | "web"
  | "admin"
  | "printer"
  | "printer-cup-label"
  | "supabase"
  | "tunnel";

export const ALL_SERVICES: readonly Service[] = [
  "web",
  "admin",
  "printer",
  "printer-cup-label",
  "supabase",
  "tunnel",
] as const;

/** 一条已脱敏的日志事件。所有 ingest 源都先归一成这个形状。 */
export interface RawLogEvent {
  service: Service;
  /** 已脱敏的错误文本 */
  message: string;
  level: "error" | "warn";
  /** epoch 毫秒 */
  timestamp: number;
  /** 源码路径，能拿到才有；用于钱路径判定与指纹 */
  file?: string;
  requestId?: string;
}
```

- [ ] **Step 2: 写失败的脱敏测试**

`packages/core/test/redact.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { redact } from "../src/redact.js";

describe("redact", () => {
  it("擦掉 Square access token", () => {
    expect(redact("token=EAAAEBcNvtBLwaWaGgcGxvNqPYCnjPRLxLbNsK9m4qLGT8sQ")).toBe(
      "token=<redacted:token>",
    );
  });

  it("擦掉 Bearer token", () => {
    expect(redact("Authorization: Bearer abcdef1234567890abcdef")).toBe(
      "Authorization: Bearer <redacted:token>",
    );
  });

  it("擦掉 JWT（Supabase key 是 JWT）", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(redact(`key=${jwt}`)).toBe("key=<redacted:jwt>");
  });

  it("擦掉澳洲手机号两种写法", () => {
    expect(redact("customer 0404978238 failed")).toBe("customer <redacted:phone> failed");
    expect(redact("customer +61404978238 failed")).toBe("customer <redacted:phone> failed");
  });

  it("擦掉邮箱", () => {
    expect(redact("user stan@example.com not found")).toBe(
      "user <redacted:email> not found",
    );
  });

  it("擦掉连续 13-19 位数字（卡号形状）", () => {
    expect(redact("pan 4242424242424242 declined")).toBe("pan <redacted:pan> declined");
  });

  it("不误伤订单 id 与普通短数字", () => {
    expect(redact("order 12345 failed after 3 retries")).toBe(
      "order 12345 failed after 3 retries",
    );
  });

  it("同一行多个敏感值全部擦掉", () => {
    expect(redact("stan@example.com / 0404978238")).toBe(
      "<redacted:email> / <redacted:phone>",
    );
  });

  it("空串安全", () => {
    expect(redact("")).toBe("");
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd ~/Github/mandys-selfheal && npx vitest run packages/core/test/redact.test.ts
```

预期：FAIL，`Cannot find module '../src/redact.js'`

- [ ] **Step 4: 写 redact.ts**

顺序有意义：先擦长而具体的（JWT、卡号），再擦短而宽泛的（手机号），避免宽规则先把长串切碎。

```ts
/**
 * 数据出境前的最后一道闸。日志会被发往第三方 API，任何漏网的
 * token 或 PII 都是不可撤回的泄漏，所以这里宁可误伤不可漏放。
 *
 * 规则顺序有意义：长而具体的模式必须先于短而宽泛的模式，
 * 否则手机号规则会把 JWT 中段切碎、留下可拼回的残片。
 */
const RULES: readonly [RegExp, string][] = [
  // JWT（Supabase anon/service key 就是 JWT）
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, "<redacted:jwt>"],
  // Bearer <token>
  [/\bBearer\s+[A-Za-z0-9._\-]{16,}/g, "Bearer <redacted:token>"],
  // Square token：EAAA/sq0 前缀，或裸的长 base64ish 串
  [/\b(?:EAAA|sq0[a-z]{3}-)[A-Za-z0-9_\-]{16,}\b/g, "<redacted:token>"],
  // 卡号形状：13-19 位连续数字
  [/\b\d{13,19}\b/g, "<redacted:pan>"],
  // 澳洲手机号：+614xxxxxxxx / 04xxxxxxxx
  [/(?:\+61|0)4\d{8}\b/g, "<redacted:phone>"],
  // 邮箱
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "<redacted:email>"],
];

export function redact(input: string): string {
  let out = input;
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd ~/Github/mandys-selfheal && npx vitest run packages/core/test/redact.test.ts
```

预期：9 passed

- [ ] **Step 6: 导出并跑全门禁**

`packages/core/src/index.ts`：

```ts
export * from "./types.js";
export * from "./redact.js";
```

```bash
cd ~/Github/mandys-selfheal && npm test && npm run lint && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): redact secrets and PII before anything leaves the box

Ordered longest-pattern-first on purpose: the phone rule would otherwise
chop a JWT mid-segment and leave reassemblable fragments behind."
```

---

### Task 3: core — 归一化与指纹

去重是整个系统的命门。一个每秒刷 100 次的 error，指纹算错就是 100 条 incident。

**Files:**
- Create: `packages/core/src/fingerprint.ts`
- Create: `packages/core/test/fingerprint.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `RawLogEvent`（Task 2）
- Produces:
  - `function normalize(message: string): string`
  - `function fingerprint(event: Pick<RawLogEvent, "service" | "message" | "file">): Promise<string>` — 返回 16 字符 hex

`fingerprint` 是 async：Workers 运行时只有 WebCrypto，`crypto.subtle.digest` 返回 Promise。Node 22 同样提供全局 `crypto.subtle`，两侧共用一份实现。

- [ ] **Step 1: 写失败的测试**

`packages/core/test/fingerprint.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { fingerprint, normalize } from "../src/fingerprint.js";

describe("normalize", () => {
  it("把数字抹成占位符", () => {
    expect(normalize("order 12345 failed")).toBe("order <n> failed");
  });

  it("把 UUID 抹成占位符", () => {
    expect(normalize("job 3f2504e0-4f89-11d3-9a0c-0305e82c3301 stuck")).toBe(
      "job <uuid> stuck",
    );
  });

  it("把 ISO 时间戳抹成占位符", () => {
    expect(normalize("at 2026-08-07T10:31:00.000Z retry")).toBe("at <ts> retry");
  });

  it("把长 hex id 抹成占位符", () => {
    expect(normalize("deployment dpl_9aF3bC7e1D2x stuck")).toBe("deployment dpl_<id> stuck");
  });

  it("把脱敏占位符本身也归一（不同 token 不应算不同故障）", () => {
    expect(normalize("token <redacted:token> invalid")).toBe("token <redacted> invalid");
  });

  it("压平连续空白并去首尾", () => {
    expect(normalize("  a   b  ")).toBe("a b");
  });
});

describe("fingerprint", () => {
  it("同一故障不同订单号 → 同一指纹", async () => {
    const a = await fingerprint({ service: "web", message: "order abc123 failed" });
    const b = await fingerprint({ service: "web", message: "order def456 failed" });
    expect(a).toBe(b);
  });

  it("不同服务 → 不同指纹", async () => {
    const a = await fingerprint({ service: "web", message: "poll failed" });
    const b = await fingerprint({ service: "admin", message: "poll failed" });
    expect(a).not.toBe(b);
  });

  it("不同源文件 → 不同指纹", async () => {
    const a = await fingerprint({ service: "web", message: "boom", file: "src/a.ts" });
    const b = await fingerprint({ service: "web", message: "boom", file: "src/b.ts" });
    expect(a).not.toBe(b);
  });

  it("file 缺失与 file 为空串等价", async () => {
    const a = await fingerprint({ service: "web", message: "boom" });
    const b = await fingerprint({ service: "web", message: "boom", file: "" });
    expect(a).toBe(b);
  });

  it("返回 16 字符小写 hex", async () => {
    const fp = await fingerprint({ service: "web", message: "boom" });
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ~/Github/mandys-selfheal && npx vitest run packages/core/test/fingerprint.test.ts
```

预期：FAIL，模块不存在

- [ ] **Step 3: 写 fingerprint.ts**

```ts
import type { RawLogEvent } from "./types.js";

/** 顺序有意义：先长后短，否则 <n> 规则会把 UUID 与时间戳切碎。 */
const NORMALIZERS: readonly [RegExp, string][] = [
  [/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, "<ts>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  [/<redacted:[a-z]+>/g, "<redacted>"],
  // 混合字母数字的 id（dpl_9aF3bC7e、ord_x8K2）：只抹 id 段，保留前缀
  [/\b([a-z]{2,5}_)[A-Za-z0-9]{6,}\b/g, "$1<id>"],
  // 无前缀的字母+数字 id（abc123、def456）。必须排在 hex 规则之前：
  // abc12345 同时满足两条，先跑这条才不会二义。
  [/\b[a-z]{3,}\d{3,}\b/gi, "<id>"],
  [/\b[0-9a-f]{8,}\b/gi, "<id>"],
  // `\b` 两侧锚点不可去。去掉后 `\d+` 会匹配 alphanumeric token 内部的
  // 数字段（http2/http3、sha256sum、v2beta1），把两个不同故障归成同一
  // 指纹——第二个故障从此被第一个静默掩盖，且测试覆盖不到。
  [/\b\d+\b/g, "<n>"],
];

export function normalize(message: string): string {
  let out = message;
  for (const [pattern, replacement] of NORMALIZERS) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * 指纹 = sha256(service | 归一化 message | file) 的前 16 位 hex。
 *
 * 用 WebCrypto 而非 node:crypto，因为同一份实现要在 Workers 运行时里跑。
 * 截断到 16 位（64 bit）：这是去重键不是安全摘要，碰撞概率在本系统
 * 的量级下可忽略，短键让 Telegram 播报和分支名可读。
 */
export async function fingerprint(
  event: Pick<RawLogEvent, "service" | "message"> & { file?: string },
): Promise<string> {
  const key = `${event.service}|${normalize(event.message)}|${event.file ?? ""}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ~/Github/mandys-selfheal && npx vitest run packages/core/test/fingerprint.test.ts
```

预期：11 passed。

两个排错锚点：`deployment dpl_9aF3bC7e1D2x` 用例失败 → 检查 `[a-z]{2,5}_` 规则是否排在 `[0-9a-f]{8,}` 之前。「不同订单号同一指纹」用例失败 → 检查 `[a-z]{3,}\d{3,}` 规则在不在。少了这条，`abc123` 六条规则一条都不匹配（不含 `_`、不足 8 位 hex、字母数字之间没有词边界所以 `\b\d+\b` 也不命中），两个订单号会算出不同指纹。

- [ ] **Step 5: 导出并跑全门禁**

`packages/core/src/index.ts` 追加：

```ts
export * from "./fingerprint.js";
```

```bash
cd ~/Github/mandys-selfheal && npm test && npm run lint && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): fingerprint errors so one flapping fault is one incident

WebCrypto rather than node:crypto because this exact function has to run
inside the Worker too, and two implementations would drift into two
different dedup keys for the same fault."
```

---

### Task 4: core — 钱路径判定与触发门槛

**Files:**
- Create: `packages/core/src/classify.ts`
- Create: `packages/core/test/classify.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `RawLogEvent`（Task 2）
- Produces:
  - `const MONEY_PATH_PREFIXES: readonly string[]`
  - `const TRIGGER_WINDOW_MS = 300_000`
  - `function isMoneyPath(event: Pick<RawLogEvent, "file" | "message">): boolean`
  - `interface WindowState { windowStart: number; windowCount: number }`
  - `function bumpWindow(prev: WindowState | null, now: number): WindowState`
  - `function shouldAlert(moneyPath: boolean, w: WindowState): boolean`

- [ ] **Step 1: 写失败的测试**

`packages/core/test/classify.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  TRIGGER_WINDOW_MS,
  bumpWindow,
  isMoneyPath,
  shouldAlert,
} from "../src/classify.js";

describe("isMoneyPath", () => {
  it("payment 路由算钱路径", () => {
    expect(isMoneyPath({ file: "src/app/api/payment/route.ts", message: "x" })).toBe(true);
  });

  it("orders 路由算钱路径", () => {
    expect(isMoneyPath({ file: "src/app/api/orders/route.ts", message: "x" })).toBe(true);
  });

  it("loyalty 路由算钱路径", () => {
    expect(isMoneyPath({ file: "src/app/api/loyalty/account/route.ts", message: "x" })).toBe(true);
  });

  it("square.ts 与 cart.ts 算钱路径", () => {
    expect(isMoneyPath({ file: "src/lib/square.ts", message: "x" })).toBe(true);
    expect(isMoneyPath({ file: "src/store/cart.ts", message: "x" })).toBe(true);
  });

  it("catalog 路由不算钱路径", () => {
    expect(isMoneyPath({ file: "src/app/api/catalog/route.ts", message: "x" })).toBe(false);
  });

  it("没有 file 时回退到 message 里的路径串", () => {
    expect(isMoneyPath({ message: "at /src/app/api/payment/route.ts:42" })).toBe(true);
  });

  it("没有 file 且 message 无路径 → false", () => {
    expect(isMoneyPath({ message: "something broke" })).toBe(false);
  });
});

describe("bumpWindow", () => {
  it("首次事件开新窗口", () => {
    expect(bumpWindow(null, 1000)).toEqual({ windowStart: 1000, windowCount: 1 });
  });

  it("窗口内累加", () => {
    const w = bumpWindow({ windowStart: 1000, windowCount: 1 }, 2000);
    expect(w).toEqual({ windowStart: 1000, windowCount: 2 });
  });

  it("窗口过期则重开", () => {
    const w = bumpWindow({ windowStart: 1000, windowCount: 9 }, 1000 + TRIGGER_WINDOW_MS + 1);
    expect(w).toEqual({ windowStart: 1000 + TRIGGER_WINDOW_MS + 1, windowCount: 1 });
  });

  it("恰好落在窗口边界上仍算窗口内", () => {
    const w = bumpWindow({ windowStart: 1000, windowCount: 2 }, 1000 + TRIGGER_WINDOW_MS);
    expect(w).toEqual({ windowStart: 1000, windowCount: 3 });
  });
});

describe("shouldAlert", () => {
  it("钱路径第一次就报", () => {
    expect(shouldAlert(true, { windowStart: 0, windowCount: 1 })).toBe(true);
  });

  it("非钱路径第 1、2 次不报", () => {
    expect(shouldAlert(false, { windowStart: 0, windowCount: 1 })).toBe(false);
    expect(shouldAlert(false, { windowStart: 0, windowCount: 2 })).toBe(false);
  });

  it("非钱路径第 3 次报", () => {
    expect(shouldAlert(false, { windowStart: 0, windowCount: 3 })).toBe(true);
  });

  it("非钱路径第 4 次仍返回 true（去重由调用方的 alerted 标记负责）", () => {
    expect(shouldAlert(false, { windowStart: 0, windowCount: 4 })).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ~/Github/mandys-selfheal && npx vitest run packages/core/test/classify.test.ts
```

预期：FAIL，模块不存在

- [ ] **Step 3: 写 classify.ts**

```ts
import type { RawLogEvent } from "./types.js";

/**
 * 钱路径。命中即把告警门槛从「5 分钟内 3 次」降到「第一次」。
 * 清单写死不做正则推断：漏判的代价是延迟发现丢单，误判的代价只是
 * 早报一次，两边不对称。
 */
export const MONEY_PATH_PREFIXES: readonly string[] = [
  "src/app/api/payment/",
  "src/app/api/orders/",
  "src/app/api/loyalty/",
  "src/lib/square.ts",
  "src/store/cart.ts",
];

export const TRIGGER_WINDOW_MS = 300_000;
const NOISE_THRESHOLD = 3;

export function isMoneyPath(event: Pick<RawLogEvent, "message"> & { file?: string }): boolean {
  const haystack = event.file && event.file.length > 0 ? event.file : event.message;
  return MONEY_PATH_PREFIXES.some((prefix) => haystack.includes(prefix));
}

export interface WindowState {
  windowStart: number;
  windowCount: number;
}

/**
 * 滑动窗口计数。窗口过期就整体重开而不是逐条淘汰——精度换实现简单，
 * 在「够不够 3 次」这个粒度上两者结果没有可观察差别。
 */
export function bumpWindow(prev: WindowState | null, now: number): WindowState {
  if (prev === null || now - prev.windowStart > TRIGGER_WINDOW_MS) {
    return { windowStart: now, windowCount: 1 };
  }
  return { windowStart: prev.windowStart, windowCount: prev.windowCount + 1 };
}

/**
 * 只回答「这个量级够不够格告警」。同一 incident 不重复打扰由调用方
 * 的 alerted_at 标记负责，不在这里做，否则这个函数就不再是纯函数。
 */
export function shouldAlert(moneyPath: boolean, w: WindowState): boolean {
  return moneyPath ? w.windowCount >= 1 : w.windowCount >= NOISE_THRESHOLD;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ~/Github/mandys-selfheal && npx vitest run packages/core/test/classify.test.ts
```

预期：15 passed

- [ ] **Step 5: 导出并跑全门禁**

`packages/core/src/index.ts` 追加：

```ts
export * from "./classify.js";
```

```bash
cd ~/Github/mandys-selfheal && npm test && npm run lint && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): drop the alert threshold to one for money paths

Missing a dropped order costs real revenue; alerting one occurrence early
on a flap costs a Telegram line. The asymmetry is why the path list is
hardcoded rather than inferred."
```

---

### Task 5: collector — Worker 骨架与 kill switch

**Files:**
- Create: `packages/collector/package.json`, `packages/collector/tsconfig.json`, `packages/collector/wrangler.jsonc`, `packages/collector/vitest.config.ts`
- Create: `packages/collector/src/index.ts`, `packages/collector/src/switch.ts`
- Create: `packages/collector/test/switch.test.ts`, `packages/collector/test/env.d.ts`

**Interfaces:**
- Consumes: 无（本任务不用 core）
- Produces:
  - `interface Env { INCIDENTS: D1Database; SWITCH: KVNamespace; AGENT_SECRET: string; VERCEL_DRAIN_SECRET: string; TELEGRAM_BOT_TOKEN: string; TELEGRAM_CHAT_ID: string }`
  - `function isPaused(env: Env): Promise<boolean>` / `setPaused(env: Env, paused: boolean): Promise<void>`
  - 路由：`GET /health`、`POST /pause`、`POST /resume`

- [ ] **Step 1: 建包与依赖**

`packages/collector/package.json`：

```json
{
  "name": "@selfheal/collector",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "deploy": "wrangler deploy",
    "dev": "wrangler dev"
  },
  "dependencies": { "@selfheal/core": "*" },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5",
    "@cloudflare/workers-types": "^4",
    "wrangler": "^4"
  }
}
```

`packages/collector/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["@cloudflare/workers-types"] },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

```bash
cd ~/Github/mandys-selfheal && npm install
```

装完后把根 `tsconfig.json` 的 `types` 补齐（Task 1 只写了 `["node"]`，因为那时这两个包还没装）：

```json
  "compilerOptions": {
    "types": ["node", "@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]
  },
```

不补的话根 `npx tsc --noEmit` 会在 collector 上报 `Cannot find name 'D1Database' / 'KVNamespace' / 'ExportedHandler'` 与 `Cannot find module 'cloudflare:test'`——包自己的 `tsconfig.json` 管不到从根发起的那次全量检查。

- [ ] **Step 2: 写 wrangler.jsonc**

`database_id` 与 KV `id` 在 Task 10 建资源后回填，此刻先留占位符字符串。

```jsonc
{
  "name": "mandys-selfheal-collector",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-01",
  // nodejs_compat 是 @cloudflare/vitest-pool-workers 的硬性前置——没有它
  // 测试池根本起不来（报错发生在加载 Worker 之前，跟业务代码无关）。
  // 它只是打开 Workers 运行时的 Node API polyfill，不改变「core 包禁 import
  // node:*」这条约束：那条约束管的是我们自己写的代码。
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "d1_databases": [
    { "binding": "INCIDENTS", "database_name": "selfheal-incidents", "database_id": "PLACEHOLDER" }
  ],
  "kv_namespaces": [{ "binding": "SWITCH", "id": "PLACEHOLDER" }]
}
```

- [ ] **Step 3: 写 vitest.config.ts**

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: { compatibilityDate: "2026-08-01" },
      },
    },
  },
});
```

- [ ] **Step 4: 写失败的测试**

`packages/collector/test/switch.test.ts`：

```ts
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

describe("kill switch", () => {
  beforeEach(async () => {
    await env.SWITCH.delete("paused");
  });

  it("默认未暂停", async () => {
    const res = await SELF.fetch("https://x/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, paused: false });
  });

  it("POST /pause 之后 health 报 paused", async () => {
    await SELF.fetch("https://x/pause", { method: "POST" });
    const res = await SELF.fetch("https://x/health");
    expect(await res.json()).toEqual({ ok: true, paused: true });
  });

  it("POST /resume 恢复", async () => {
    await SELF.fetch("https://x/pause", { method: "POST" });
    await SELF.fetch("https://x/resume", { method: "POST" });
    const res = await SELF.fetch("https://x/health");
    expect(await res.json()).toEqual({ ok: true, paused: false });
  });

  it("未知路径 404", async () => {
    const res = await SELF.fetch("https://x/nope");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 4b: 写 test/env.d.ts**

`cloudflare:test` 导出的 `env` 类型是 `ProvidedEnv`，而 `@cloudflare/vitest-pool-workers` 把它声明成**空接口**，要求消费方自己 augment——这是该包的官方约定，没有任何 tsconfig 开关能替代。不写这个文件，`env.SWITCH` 在 `tsc` 下必然报 `Property 'SWITCH' does not exist on type 'ProvidedEnv'`（测试本身照常跑绿，vitest 不做类型检查，所以只有门禁第三条会红）。

```ts
// packages/collector/test/env.d.ts
import type { Env } from "../src/switch.js";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
```

写成 `extends Env` 而不是逐个列绑定：Task 6-9 会往 `Env` 里加东西，继承式声明自动跟上，不用每加一个绑定就回来改一次。

- [ ] **Step 5: 跑测试确认失败**

```bash
cd ~/Github/mandys-selfheal/packages/collector && npx vitest run
```

预期：FAIL，`src/index.ts` 无默认导出

- [ ] **Step 6: 写 switch.ts 与 index.ts**

`packages/collector/src/switch.ts`：

```ts
export interface Env {
  INCIDENTS: D1Database;
  SWITCH: KVNamespace;
  AGENT_SECRET: string;
  VERCEL_DRAIN_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

const PAUSE_KEY = "paused";

export async function isPaused(env: Env): Promise<boolean> {
  return (await env.SWITCH.get(PAUSE_KEY)) === "1";
}

export async function setPaused(env: Env, paused: boolean): Promise<void> {
  if (paused) {
    await env.SWITCH.put(PAUSE_KEY, "1");
  } else {
    await env.SWITCH.delete(PAUSE_KEY);
  }
}
```

`packages/collector/src/index.ts`：

```ts
import { type Env, isPaused, setPaused } from "./switch.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && pathname === "/health") {
      return Response.json({ ok: true, paused: await isPaused(env) });
    }
    if (request.method === "POST" && pathname === "/pause") {
      await setPaused(env, true);
      return Response.json({ ok: true, paused: true });
    }
    if (request.method === "POST" && pathname === "/resume") {
      await setPaused(env, false);
      return Response.json({ ok: true, paused: false });
    }
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 7: 跑测试确认通过**

```bash
cd ~/Github/mandys-selfheal/packages/collector && npx vitest run
```

预期：4 passed

- [ ] **Step 8: 跑全门禁并 commit**

```bash
cd ~/Github/mandys-selfheal && npm test && npm run lint && npx tsc --noEmit
git add packages/collector package-lock.json package.json
git commit -m "feat(collector): worker shell with a KV-backed kill switch

The switch lands before any ingest route exists so there is never a
window where the pipeline runs with no way to stop it."
```

---

### Task 6: collector — D1 schema 与 incident 累加

**Files:**
- Create: `packages/collector/migrations/0001_incidents.sql`
- Create: `packages/collector/src/incidents.ts`
- Create: `packages/collector/test/incidents.test.ts`

**Interfaces:**
- Consumes: `Env`（Task 5）、`bumpWindow` / `shouldAlert` / `isMoneyPath` / `fingerprint`（Task 3、4）
- Produces:
  - `interface RecordResult { fingerprint: string; alert: boolean; count: number; isNew: boolean }`
  - `function recordEvent(env: Env, event: RawLogEvent, now: number): Promise<RecordResult>`

- [ ] **Step 1: 写 migration**

```sql
-- packages/collector/migrations/0001_incidents.sql
CREATE TABLE IF NOT EXISTS incidents (
  fingerprint   TEXT PRIMARY KEY,
  service       TEXT NOT NULL,
  file          TEXT,
  sample        TEXT NOT NULL,
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL,
  count         INTEGER NOT NULL DEFAULT 1,
  window_start  INTEGER NOT NULL,
  window_count  INTEGER NOT NULL DEFAULT 1,
  money_path    INTEGER NOT NULL DEFAULT 0,
  -- 阶段 1 只写 'new'。状态机迁移随 healer 在阶段 2 落地。
  state         TEXT NOT NULL DEFAULT 'new',
  attempts      INTEGER NOT NULL DEFAULT 0,
  pr_url        TEXT,
  alerted_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_incidents_last_seen ON incidents(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_state ON incidents(state);
```

测试里的 D1 绑定由 `wrangler.jsonc` 的 `d1_databases` 声明自动提供（vitest-pool-workers 给每个测试文件一个隔离的内存库），**不需要**在 `vitest.config.ts` 里再声明。schema 在每个测试的 `beforeEach` 里手动执行（见 Step 2），避免依赖 wrangler 的 migration 自动发现机制——那套机制在 pool-workers 下行为不稳定，手动建表更可预测。

- [ ] **Step 2: 写失败的测试**

`packages/collector/test/incidents.test.ts`：

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { RawLogEvent } from "@selfheal/core";
import { recordEvent } from "../src/incidents.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS incidents (
  fingerprint TEXT PRIMARY KEY, service TEXT NOT NULL, file TEXT,
  sample TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1, window_start INTEGER NOT NULL,
  window_count INTEGER NOT NULL DEFAULT 1, money_path INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'new', attempts INTEGER NOT NULL DEFAULT 0,
  pr_url TEXT, alerted_at INTEGER);`;

function evt(over: Partial<RawLogEvent> = {}): RawLogEvent {
  return {
    service: "web",
    message: "poll select failed",
    level: "error",
    timestamp: 1_000_000,
    ...over,
  };
}

describe("recordEvent", () => {
  beforeEach(async () => {
    await env.INCIDENTS.exec(SCHEMA.replace(/\n/g, " "));
    await env.INCIDENTS.exec("DELETE FROM incidents");
  });

  it("首次事件建 incident，count 为 1", async () => {
    const r = await recordEvent(env, evt(), 1_000_000);
    expect(r.isNew).toBe(true);
    expect(r.count).toBe(1);
  });

  it("同一故障不同订单号合并到同一行", async () => {
    await recordEvent(env, evt({ message: "order abc123 failed" }), 1_000_000);
    const r = await recordEvent(env, evt({ message: "order def456 failed" }), 1_000_100);
    expect(r.isNew).toBe(false);
    expect(r.count).toBe(2);

    const rows = await env.INCIDENTS.prepare("SELECT COUNT(*) AS n FROM incidents").first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("非钱路径前两次不告警，第三次告警", async () => {
    const a = await recordEvent(env, evt(), 1_000_000);
    const b = await recordEvent(env, evt(), 1_000_100);
    const c = await recordEvent(env, evt(), 1_000_200);
    expect([a.alert, b.alert, c.alert]).toEqual([false, false, true]);
  });

  it("钱路径第一次就告警", async () => {
    const r = await recordEvent(
      env,
      evt({ file: "src/app/api/payment/route.ts" }),
      1_000_000,
    );
    expect(r.alert).toBe(true);
  });

  it("已告警过的 incident 不再重复告警", async () => {
    const e = evt({ file: "src/app/api/payment/route.ts" });
    expect((await recordEvent(env, e, 1_000_000)).alert).toBe(true);
    expect((await recordEvent(env, e, 1_000_100)).alert).toBe(false);
  });

  it("窗口过期后计数重开，不会因陈年累计而误报", async () => {
    await recordEvent(env, evt(), 1_000_000);
    await recordEvent(env, evt(), 1_000_100);
    // 隔 10 分钟，超过 5 分钟窗口
    const r = await recordEvent(env, evt(), 1_000_000 + 600_000);
    expect(r.alert).toBe(false);
    expect(r.count).toBe(3);
  });

  it("first_seen 保持不变，last_seen 前进", async () => {
    await recordEvent(env, evt(), 1_000_000);
    await recordEvent(env, evt(), 1_000_500);
    const row = await env.INCIDENTS.prepare(
      "SELECT first_seen, last_seen FROM incidents",
    ).first<{ first_seen: number; last_seen: number }>();
    expect(row).toEqual({ first_seen: 1_000_000, last_seen: 1_000_500 });
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd ~/Github/mandys-selfheal/packages/collector && npx vitest run test/incidents.test.ts
```

预期：FAIL，模块不存在

- [ ] **Step 4: 写 incidents.ts**

```ts
import {
  type RawLogEvent,
  type WindowState,
  bumpWindow,
  fingerprint,
  isMoneyPath,
  shouldAlert,
} from "@selfheal/core";
import type { Env } from "./switch.js";

export interface RecordResult {
  fingerprint: string;
  alert: boolean;
  count: number;
  isNew: boolean;
}

interface Row {
  first_seen: number;
  count: number;
  window_start: number;
  window_count: number;
  alerted_at: number | null;
}

/**
 * 把一条事件并进它的 incident，并回答「这次要不要告警」。
 *
 * 读-改-写而非单条 UPSERT：窗口重开的判断依赖旧的 window_start，
 * SQLite 的 upsert 表达不了这个分支。D1 单实例串行执行，
 * 本系统的写入量级下竞态窗口可忽略。
 */
export async function recordEvent(
  env: Env,
  event: RawLogEvent,
  now: number,
): Promise<RecordResult> {
  const fp = await fingerprint(event);
  const money = isMoneyPath(event);

  const prev = await env.INCIDENTS.prepare(
    "SELECT first_seen, count, window_start, window_count, alerted_at FROM incidents WHERE fingerprint = ?",
  )
    .bind(fp)
    .first<Row>();

  const prevWindow: WindowState | null = prev
    ? { windowStart: prev.window_start, windowCount: prev.window_count }
    : null;
  const window = bumpWindow(prevWindow, now);
  const count = (prev?.count ?? 0) + 1;

  // 一个 incident 只打扰一次。够格但已报过的，静默累加。
  const alert = shouldAlert(money, window) && prev?.alerted_at == null;

  await env.INCIDENTS.prepare(
    `INSERT INTO incidents
       (fingerprint, service, file, sample, first_seen, last_seen, count,
        window_start, window_count, money_path, state, alerted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
     ON CONFLICT(fingerprint) DO UPDATE SET
       last_seen = excluded.last_seen,
       count = excluded.count,
       window_start = excluded.window_start,
       window_count = excluded.window_count,
       sample = excluded.sample,
       alerted_at = COALESCE(incidents.alerted_at, excluded.alerted_at)`,
  )
    .bind(
      fp,
      event.service,
      event.file ?? null,
      event.message.slice(0, 2000),
      prev?.first_seen ?? now,
      now,
      count,
      window.windowStart,
      window.windowCount,
      money ? 1 : 0,
      alert ? now : null,
    )
    .run();

  return { fingerprint: fp, alert, count, isNew: prev == null };
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd ~/Github/mandys-selfheal/packages/collector && npx vitest run test/incidents.test.ts
```

预期：7 passed

- [ ] **Step 6: 跑全门禁并 commit**

```bash
cd ~/Github/mandys-selfheal && npm test && npm run lint && npx tsc --noEmit
git add packages/collector
git commit -m "feat(collector): fold events into incidents with a per-window count

Read-modify-write instead of a bare UPSERT because reopening an expired
window is a branch on the old window_start, which SQLite's upsert cannot
express. D1 serialises writes, so the race window does not matter here."
```

---

### Task 7: collector — `/ingest/vercel`

**Files:**
- Create: `packages/collector/src/verify.ts`
- Create: `packages/collector/src/vercel.ts`
- Create: `packages/collector/test/vercel.test.ts`
- Modify: `packages/collector/src/index.ts`

**Interfaces:**
- Consumes: `Env`、`recordEvent`
- Produces:
  - `function verifyVercelSignature(rawBody: string, header: string | null, secret: string): Promise<boolean>`
  - `function parseVercelDrain(body: unknown): RawLogEvent[]`
  - 路由 `POST /ingest/vercel`

Vercel Log Drain 以 JSON 数组 POST，`x-vercel-signature` 为原始 body 的 **HMAC-SHA1** hex。项目名到 `Service` 的映射：`mandy-s-bubble-tea` → `web`，`mandys-bubble-tea-admin` → `admin`。

- [ ] **Step 1: 写失败的测试**

`packages/collector/test/vercel.test.ts`：

```ts
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { parseVercelDrain } from "../src/vercel.js";

const SCHEMA = `CREATE TABLE IF NOT EXISTS incidents (
  fingerprint TEXT PRIMARY KEY, service TEXT NOT NULL, file TEXT,
  sample TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1, window_start INTEGER NOT NULL,
  window_count INTEGER NOT NULL DEFAULT 1, money_path INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'new', attempts INTEGER NOT NULL DEFAULT 0,
  pr_url TEXT, alerted_at INTEGER);`;

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("parseVercelDrain", () => {
  it("只保留 error 与 warning 级别", () => {
    const out = parseVercelDrain([
      { projectName: "mandy-s-bubble-tea", level: "error", message: "boom", timestamp: 1 },
      { projectName: "mandy-s-bubble-tea", level: "info", message: "ok", timestamp: 2 },
      { projectName: "mandy-s-bubble-tea", level: "warning", message: "hmm", timestamp: 3 },
    ]);
    expect(out.map((e) => e.message)).toEqual(["boom", "hmm"]);
    expect(out.map((e) => e.level)).toEqual(["error", "warn"]);
  });

  it("按项目名映射 service", () => {
    const out = parseVercelDrain([
      { projectName: "mandys-bubble-tea-admin", level: "error", message: "x", timestamp: 1 },
    ]);
    expect(out[0]?.service).toBe("admin");
  });

  it("未知项目名整条丢弃", () => {
    expect(
      parseVercelDrain([{ projectName: "someone-else", level: "error", message: "x", timestamp: 1 }]),
    ).toEqual([]);
  });

  it("入库前脱敏", () => {
    const out = parseVercelDrain([
      { projectName: "mandy-s-bubble-tea", level: "error", message: "call 0404978238", timestamp: 1 },
    ]);
    expect(out[0]?.message).toBe("call <redacted:phone>");
  });

  it("从栈里抽出 src/ 路径当 file", () => {
    const out = parseVercelDrain([
      {
        projectName: "mandy-s-bubble-tea",
        level: "error",
        message: "TypeError: x\n    at h (/var/task/src/app/api/payment/route.ts:42:9)",
        timestamp: 1,
      },
    ]);
    expect(out[0]?.file).toBe("src/app/api/payment/route.ts");
  });

  it("非数组 body 返回空数组而不是抛", () => {
    expect(parseVercelDrain({ nope: true })).toEqual([]);
  });
});

describe("POST /ingest/vercel", () => {
  beforeEach(async () => {
    await env.INCIDENTS.exec(SCHEMA.replace(/\n/g, " "));
    await env.INCIDENTS.exec("DELETE FROM incidents");
    await env.SWITCH.delete("paused");
  });

  it("签名错 → 401，且不写库", async () => {
    const body = JSON.stringify([
      { projectName: "mandy-s-bubble-tea", level: "error", message: "boom", timestamp: 1 },
    ]);
    const res = await SELF.fetch("https://x/ingest/vercel", {
      method: "POST",
      headers: { "x-vercel-signature": "deadbeef" },
      body,
    });
    expect(res.status).toBe(401);
    const row = await env.INCIDENTS.prepare("SELECT COUNT(*) AS n FROM incidents").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("签名对 → 200 且写库", async () => {
    const body = JSON.stringify([
      { projectName: "mandy-s-bubble-tea", level: "error", message: "boom", timestamp: 1 },
    ]);
    const res = await SELF.fetch("https://x/ingest/vercel", {
      method: "POST",
      headers: { "x-vercel-signature": await sign(body, env.VERCEL_DRAIN_SECRET) },
      body,
    });
    expect(res.status).toBe(200);
    const row = await env.INCIDENTS.prepare("SELECT COUNT(*) AS n FROM incidents").first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("paused 时接收但不写库", async () => {
    await SELF.fetch("https://x/pause", { method: "POST" });
    const body = JSON.stringify([
      { projectName: "mandy-s-bubble-tea", level: "error", message: "boom", timestamp: 1 },
    ]);
    const res = await SELF.fetch("https://x/ingest/vercel", {
      method: "POST",
      headers: { "x-vercel-signature": await sign(body, env.VERCEL_DRAIN_SECRET) },
      body,
    });
    expect(res.status).toBe(200);
    const row = await env.INCIDENTS.prepare("SELECT COUNT(*) AS n FROM incidents").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
```

在 `vitest.config.ts` 的 `miniflare` 段加测试用 secret：

```ts
          bindings: {
            VERCEL_DRAIN_SECRET: "test-drain-secret",
            AGENT_SECRET: "test-agent-secret",
            TELEGRAM_BOT_TOKEN: "test-bot",
            TELEGRAM_CHAT_ID: "test-chat",
          },
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ~/Github/mandys-selfheal/packages/collector && npx vitest run test/vercel.test.ts
```

预期：FAIL，模块不存在

- [ ] **Step 3: 写 verify.ts**

```ts
function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 恒定时间比较，避免签名校验退化成计时预言机。 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(
  secret: string,
  body: string,
  hash: "SHA-1" | "SHA-256",
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}

/** Vercel Log Drain 用 HMAC-SHA1 签原始 body，放在 x-vercel-signature。 */
export async function verifyVercelSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header) return false;
  return timingSafeEqual(header, await hmacHex(secret, rawBody, "SHA-1"));
}

/** agent 与 poller 自己签，用更强的 SHA-256。 */
export async function verifyAgentSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header) return false;
  return timingSafeEqual(header, await hmacHex(secret, rawBody, "SHA-256"));
}

export { hmacHex };
```

- [ ] **Step 4: 写 vercel.ts**

```ts
import { type RawLogEvent, type Service, redact } from "@selfheal/core";

const PROJECT_TO_SERVICE: Record<string, Service> = {
  "mandy-s-bubble-tea": "web",
  "mandys-bubble-tea-admin": "admin",
};

const SRC_PATH = /(?:^|[\s(/])(src\/[\w./-]+\.tsx?)(?::\d+)?/;

interface DrainLine {
  projectName?: unknown;
  level?: unknown;
  message?: unknown;
  timestamp?: unknown;
  requestId?: unknown;
}

/**
 * Vercel Log Drain 的 payload 是一个 JSON 数组。未知项目名整条丢弃，
 * 而不是归到某个兜底 service——错归的日志会污染指纹，比丢掉更难查。
 */
export function parseVercelDrain(body: unknown): RawLogEvent[] {
  if (!Array.isArray(body)) return [];
  const out: RawLogEvent[] = [];

  for (const line of body as DrainLine[]) {
    const service = PROJECT_TO_SERVICE[String(line.projectName ?? "")];
    if (!service) continue;

    const level = line.level === "error" ? "error" : line.level === "warning" ? "warn" : null;
    if (!level) continue;

    const message = redact(String(line.message ?? ""));
    const file = SRC_PATH.exec(message)?.[1];

    out.push({
      service,
      message,
      level,
      timestamp: Number(line.timestamp ?? 0),
      ...(file ? { file } : {}),
      ...(line.requestId ? { requestId: String(line.requestId) } : {}),
    });
  }
  return out;
}
```

- [ ] **Step 5: 接进路由**

`packages/collector/src/index.ts` 改为：

```ts
import { recordEvent } from "./incidents.js";
import { type Env, isPaused, setPaused } from "./switch.js";
import { parseVercelDrain } from "./vercel.js";
import { verifyVercelSignature } from "./verify.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && pathname === "/health") {
      return Response.json({ ok: true, paused: await isPaused(env) });
    }
    if (request.method === "POST" && pathname === "/pause") {
      await setPaused(env, true);
      return Response.json({ ok: true, paused: true });
    }
    if (request.method === "POST" && pathname === "/resume") {
      await setPaused(env, false);
      return Response.json({ ok: true, paused: false });
    }

    if (request.method === "POST" && pathname === "/ingest/vercel") {
      const raw = await request.text();
      const ok = await verifyVercelSignature(
        raw,
        request.headers.get("x-vercel-signature"),
        env.VERCEL_DRAIN_SECRET,
      );
      if (!ok) return new Response("bad signature", { status: 401 });

      // 暂停时照常 200：让 Vercel 认为投递成功，避免它重试堆积。
      if (await isPaused(env)) return Response.json({ ok: true, ingested: 0, paused: true });

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return new Response("bad json", { status: 400 });
      }

      const events = parseVercelDrain(parsed);
      const now = Date.now();
      for (const event of events) await recordEvent(env, event, now);
      return Response.json({ ok: true, ingested: events.length });
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 6: 跑测试确认通过**

```bash
cd ~/Github/mandys-selfheal/packages/collector && npx vitest run
```

预期：全部 passed（switch 4 + incidents 7 + vercel 9）

- [ ] **Step 7: 跑全门禁并 commit**

```bash
cd ~/Github/mandys-selfheal && npm test && npm run lint && npx tsc --noEmit
git add packages/collector
git commit -m "feat(collector): ingest Vercel log drains for web and admin

Unknown project names are dropped rather than bucketed into a fallback
service: a misattributed log poisons its fingerprint, which is harder to
notice later than a log that simply never arrived.

Paused still answers 200 so Vercel does not queue retries behind a
deliberate stop."
```

---

### Task 8: collector — `/ingest/agent`

Mac mini agent 与 Supabase poller 共用此端点。它们已经在本地把日志归一成 `RawLogEvent`，所以 payload 就是 `RawLogEvent[]`。

**Files:**
- Create: `packages/collector/test/agent-ingest.test.ts`
- Modify: `packages/collector/src/index.ts`

**Interfaces:**
- Consumes: `verifyAgentSignature`（Task 7）、`recordEvent`
- Produces: 路由 `POST /ingest/agent`，请求头 `x-selfheal-signature` = HMAC-SHA256(body, AGENT_SECRET) hex

- [ ] **Step 1: 写失败的测试**

`packages/collector/test/agent-ingest.test.ts`：

```ts
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const SCHEMA = `CREATE TABLE IF NOT EXISTS incidents (
  fingerprint TEXT PRIMARY KEY, service TEXT NOT NULL, file TEXT,
  sample TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1, window_start INTEGER NOT NULL,
  window_count INTEGER NOT NULL DEFAULT 1, money_path INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'new', attempts INTEGER NOT NULL DEFAULT 0,
  pr_url TEXT, alerted_at INTEGER);`;

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.AGENT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function post(events: unknown): Promise<Response> {
  const body = JSON.stringify(events);
  return SELF.fetch("https://x/ingest/agent", {
    method: "POST",
    headers: { "x-selfheal-signature": await sign(body) },
    body,
  });
}

const printerEvent = {
  service: "printer",
  message: "[queue] poll select failed (realtime): timeout",
  level: "error",
  timestamp: 1_700_000_000_000,
};

describe("POST /ingest/agent", () => {
  beforeEach(async () => {
    await env.INCIDENTS.exec(SCHEMA.replace(/\n/g, " "));
    await env.INCIDENTS.exec("DELETE FROM incidents");
    await env.SWITCH.delete("paused");
  });

  it("无签名 → 401", async () => {
    const res = await SELF.fetch("https://x/ingest/agent", {
      method: "POST",
      body: JSON.stringify([printerEvent]),
    });
    expect(res.status).toBe(401);
  });

  it("签名对 → 200 且写库", async () => {
    const res = await post([printerEvent]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ingested: 1 });
  });

  it("批量事件全部入库", async () => {
    await post([printerEvent, { ...printerEvent, service: "supabase", message: "conn refused" }]);
    const row = await env.INCIDENTS.prepare("SELECT COUNT(*) AS n FROM incidents").first<{ n: number }>();
    expect(row?.n).toBe(2);
  });

  it("未知 service 的条目被跳过，其余照常入库", async () => {
    const res = await post([{ ...printerEvent, service: "bogus" }, printerEvent]);
    expect(await res.json()).toEqual({ ok: true, ingested: 1 });
  });

  it("collector 侧二次脱敏（不信任上游做过）", async () => {
    await post([{ ...printerEvent, message: "customer 0404978238 failed" }]);
    const row = await env.INCIDENTS.prepare("SELECT sample FROM incidents").first<{ sample: string }>();
    expect(row?.sample).toBe("customer <redacted:phone> failed");
  });

  it("非数组 body → 400", async () => {
    const res = await post({ nope: true });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ~/Github/mandys-selfheal/packages/collector && npx vitest run test/agent-ingest.test.ts
```

预期：FAIL，401 之外的用例全挂（路由不存在，返回 404）

- [ ] **Step 3: 实现路由**

在 `packages/collector/src/index.ts` 的 `/ingest/vercel` 分支之后插入：

```ts
    if (request.method === "POST" && pathname === "/ingest/agent") {
      const raw = await request.text();
      const ok = await verifyAgentSignature(
        raw,
        request.headers.get("x-selfheal-signature"),
        env.AGENT_SECRET,
      );
      if (!ok) return new Response("bad signature", { status: 401 });
      if (await isPaused(env)) return Response.json({ ok: true, ingested: 0, paused: true });

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return new Response("bad json", { status: 400 });
      }
      if (!Array.isArray(parsed)) return new Response("expected array", { status: 400 });

      const events = parseAgentEvents(parsed);
      const now = Date.now();
      for (const event of events) await recordEvent(env, event, now);
      return Response.json({ ok: true, ingested: events.length });
    }
```

顶部 import 补上：

```ts
import { verifyAgentSignature, verifyVercelSignature } from "./verify.js";
import { parseAgentEvents } from "./agent.js";
```

新建 `packages/collector/src/agent.ts`：

```ts
import { ALL_SERVICES, type RawLogEvent, type Service, redact } from "@selfheal/core";

interface Incoming {
  service?: unknown;
  message?: unknown;
  level?: unknown;
  timestamp?: unknown;
  file?: unknown;
}

/**
 * agent 与 poller 已在本地脱敏，这里再擦一遍。上游是我们自己写的，
 * 但 collector 是数据进入持久层的最后一关，重复一次的成本是几微秒，
 * 漏一次的成本不可撤回。
 */
export function parseAgentEvents(body: unknown[]): RawLogEvent[] {
  const out: RawLogEvent[] = [];

  for (const item of body as Incoming[]) {
    const service = String(item.service ?? "") as Service;
    if (!ALL_SERVICES.includes(service)) continue;

    const level = item.level === "warn" ? "warn" : item.level === "error" ? "error" : null;
    if (!level) continue;

    const file = typeof item.file === "string" && item.file.length > 0 ? item.file : undefined;

    out.push({
      service,
      message: redact(String(item.message ?? "")),
      level,
      timestamp: Number(item.timestamp ?? 0),
      ...(file ? { file } : {}),
    });
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ~/Github/mandys-selfheal/packages/collector && npx vitest run
```

预期：全部 passed

- [ ] **Step 5: 跑全门禁并 commit**

```bash
cd ~/Github/mandys-selfheal && npm test && npm run lint && npx tsc --noEmit
git add packages/collector
git commit -m "feat(collector): accept signed batches from the agent and poller

Redacts again on arrival even though both senders already did. They are
our own code, but this is the last gate before the data persists and the
repeat costs microseconds while a miss is irreversible."
```

---

### Task 9: collector — Telegram 告警

**Files:**
- Create: `packages/collector/src/notify.ts`
- Create: `packages/collector/test/notify.test.ts`
- Modify: `packages/collector/src/index.ts`

**Interfaces:**
- Consumes: `Env`、`RecordResult`
- Produces: `function notifyIncident(env: Env, event: RawLogEvent, result: RecordResult): Promise<void>`

- [ ] **Step 1: 写失败的测试**

`packages/collector/test/notify.test.ts`：

```ts
import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { RawLogEvent } from "@selfheal/core";
import { notifyIncident } from "../src/notify.js";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const event: RawLogEvent = {
  service: "web",
  message: "TypeError: cannot read x",
  level: "error",
  timestamp: 1_700_000_000_000,
  file: "src/app/api/payment/route.ts",
};

describe("notifyIncident", () => {
  it("POST 到 Telegram sendMessage，正文含服务、指纹、样本", async () => {
    let sent = "";
    fetchMock
      .get("https://api.telegram.org")
      .intercept({ path: `/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, method: "POST" })
      .reply(200, (opts) => {
        sent = String(opts.body);
        return { ok: true };
      });

    await notifyIncident(env, event, {
      fingerprint: "abcdef0123456789",
      alert: true,
      count: 1,
      isNew: true,
    });

    expect(sent).toContain("web");
    expect(sent).toContain("abcdef0123456789");
    expect(sent).toContain("TypeError");
    expect(sent).toContain("src/app/api/payment/route.ts");
  });

  it("Telegram 挂了不抛异常（告警失败不能拖垮 ingest）", async () => {
    fetchMock
      .get("https://api.telegram.org")
      .intercept({ path: `/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, method: "POST" })
      .reply(500, "boom");

    await expect(
      notifyIncident(env, event, {
        fingerprint: "abcdef0123456789",
        alert: true,
        count: 1,
        isNew: true,
      }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ~/Github/mandys-selfheal/packages/collector && npx vitest run test/notify.test.ts
```

预期：FAIL，模块不存在

- [ ] **Step 3: 写 notify.ts**

```ts
import type { RawLogEvent } from "@selfheal/core";
import type { RecordResult } from "./incidents.js";
import type { Env } from "./switch.js";

/**
 * 告警是尽力而为。Telegram 挂掉不能反过来让 ingest 失败——
 * 那会让 Vercel 重试、日志堆积，把一次通知故障放大成一次数据故障。
 */
export async function notifyIncident(
  env: Env,
  event: RawLogEvent,
  result: RecordResult,
): Promise<void> {
  const text = [
    `🔴 ${event.service}${result.count > 1 ? ` ×${result.count}` : ""}`,
    event.file ? `📄 ${event.file}` : null,
    `🔑 ${result.fingerprint}`,
    "",
    event.message.slice(0, 900),
  ]
    .filter((line) => line !== null)
    .join("\n");

  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        disable_notification: false,
      }),
    });
  } catch {
    // 吞掉：见上方注释。Worker 的 observability 会记下这次 fetch 失败。
  }
}
```

- [ ] **Step 4: 在两个 ingest 分支里接上**

把两处 `for (const event of events) await recordEvent(env, event, now);` 替换为：

```ts
      for (const event of events) {
        const result = await recordEvent(env, event, now);
        if (result.alert) await notifyIncident(env, event, result);
      }
```

顶部 import 补 `import { notifyIncident } from "./notify.js";`

- [ ] **Step 5: 跑测试确认通过**

```bash
cd ~/Github/mandys-selfheal/packages/collector && npx vitest run
```

预期：全部 passed。若既有 ingest 测试因 `fetchMock` 未拦截 Telegram 而失败，说明钱路径样本触发了告警——在那些测试的 `beforeEach` 里加 `fetchMock.deactivate()` 或改用非钱路径样本。

- [ ] **Step 6: 跑全门禁并 commit**

```bash
cd ~/Github/mandys-selfheal && npm test && npm run lint && npx tsc --noEmit
git add packages/collector
git commit -m "feat(collector): telegram the first occurrence of each incident

Swallows Telegram failures on purpose: letting a notification outage fail
the ingest would make Vercel retry and queue logs, turning a cosmetic
problem into a data one."
```

---

### Task 10: collector — 建资源、部署、接两个 Log Drain

本任务动真实云资源，无单测；验收靠端到端观察。

**Files:**
- Modify: `packages/collector/wrangler.jsonc`（回填真实 id）
- Create: `packages/collector/README.md`

**Interfaces:**
- Consumes: 前九个任务的全部产出
- Produces: 线上 Worker URL `https://mandys-selfheal-collector.<subdomain>.workers.dev`

- [ ] **Step 1: 建 D1 与 KV，回填 wrangler.jsonc**

```bash
cd ~/Github/mandys-selfheal/packages/collector
npx wrangler d1 create selfheal-incidents
npx wrangler kv namespace create SWITCH
```

把两条命令输出的 `database_id` 与 KV `id` 替换掉 `wrangler.jsonc` 里的 `PLACEHOLDER`。

- [ ] **Step 2: 应用 migration**

```bash
npx wrangler d1 execute selfheal-incidents --remote --file=./migrations/0001_incidents.sql
npx wrangler d1 execute selfheal-incidents --remote --command="SELECT name FROM sqlite_master WHERE type='table'"
```

预期第二条输出含 `incidents`。

- [ ] **Step 3: 生成并写入 secrets**

```bash
# 生成两个随机密钥，记下来——agent 与 Vercel drain 各要用一份
openssl rand -hex 32   # → 这个当 AGENT_SECRET
openssl rand -hex 32   # → 这个当 VERCEL_DRAIN_SECRET

npx wrangler secret put AGENT_SECRET
npx wrangler secret put VERCEL_DRAIN_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN   # 复用 mandys-shop-log 的 bot
npx wrangler secret put TELEGRAM_CHAT_ID
```

**这四个值只存在于 wrangler secret 与你的密码管理器里，禁写进任何文件。**

- [ ] **Step 4: 部署并验活**

```bash
npx wrangler deploy
curl -s https://mandys-selfheal-collector.<subdomain>.workers.dev/health
```

预期：`{"ok":true,"paused":false}`

- [ ] **Step 5: 接两个 Vercel Log Drain**

Vercel Dashboard → Team Settings → Log Drains → Add：

- Sources: 勾 `Function` 与 `Edge`（`Static` 不需要）
- Delivery format: `JSON`
- Endpoint: `https://mandys-selfheal-collector.<subdomain>.workers.dev/ingest/vercel`
- Secret: 填 Step 3 生成的 `VERCEL_DRAIN_SECRET`
- Projects: `mandy-s-bubble-tea` 与 `mandys-bubble-tea-admin` 各建一条（或一条 drain 勾两个项目，视 Dashboard 版本而定）

- [ ] **Step 6: 端到端验证**

在主站触发一个真实 404 或调一个已知会报错的 API，然后：

```bash
cd ~/Github/mandys-selfheal/packages/collector
npx wrangler d1 execute selfheal-incidents --remote \
  --command="SELECT service, count, money_path, substr(sample,1,80) FROM incidents ORDER BY last_seen DESC LIMIT 5"
npx wrangler tail
```

预期：能看到 incident 行，且 `service` 正确。若 `x-vercel-signature` 校验一直 401，用 `npx wrangler tail` 看实际收到的 header 名与 body 前缀，核对签名算法是否为 SHA-1；Vercel 若已改用 `sha256=` 前缀格式，相应调整 `verifyVercelSignature` 并补一个测试。

- [ ] **Step 7: 写 README 并 commit**

`packages/collector/README.md` 记录：Worker URL、两个 secret 的用途、kill switch 用法（`curl -X POST <url>/pause`）、常用 D1 查询。

```bash
cd ~/Github/mandys-selfheal
git add packages/collector
git commit -m "chore(collector): wire the live D1, KV and both Vercel log drains

wrangler.jsonc now carries the real resource ids; every secret stays in
wrangler secret and never lands in the repo."
```

---

### Task 11: agent — tail 与解析 printer-client 日志

**Files:**
- Create: `packages/agent/package.json`, `packages/agent/tsconfig.json`
- Create: `packages/agent/src/parse.ts`, `packages/agent/src/tail.ts`, `packages/agent/src/config.ts`
- Create: `packages/agent/test/parse.test.ts`, `packages/agent/test/tail.test.ts`

**Interfaces:**
- Consumes: `RawLogEvent`、`redact`（core）
- Produces:
  - `function parseLine(line: string, service: Service, now: number): RawLogEvent | null`
  - `class Tailer { constructor(path: string); read(): Promise<string[]> }`

printer-client 的真实日志行形如 `[queue] poll select failed (realtime): timeout`、`[main] uncaughtException: Error: ...`。前缀 `[module]` 是唯一稳定的结构，用它筛错误行。

- [ ] **Step 1: 建包**

`packages/agent/package.json`：

```json
{
  "name": "@selfheal/agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./ship": "./src/ship.ts"
  },
  "scripts": {
    "test": "vitest run",
    "start": "tsx src/index.ts"
  },
  "dependencies": { "@selfheal/core": "*" }
}
```

**`exports` 里单独开 `./ship`：** poller 要复用 `Shipper`，但不能 import agent 的 `.` 入口——那个模块一被加载就 `setInterval` 起了 tail 循环。显式子路径导出把「可复用的类」和「会自启的进程入口」分开。

`packages/agent/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

```bash
cd ~/Github/mandys-selfheal && npm install
```

- [ ] **Step 2: 写失败的解析测试**

`packages/agent/test/parse.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { parseLine } from "../src/parse.js";

const NOW = 1_700_000_000_000;

describe("parseLine", () => {
  it("识别 [queue] 前缀的错误行", () => {
    const e = parseLine("[queue] poll select failed (realtime): timeout", "printer", NOW);
    expect(e).toEqual({
      service: "printer",
      message: "[queue] poll select failed (realtime): timeout",
      level: "error",
      timestamp: NOW,
    });
  });

  it("识别 uncaughtException 行", () => {
    const e = parseLine("[main] uncaughtException: Error: USB device gone", "printer", NOW);
    expect(e?.level).toBe("error");
  });

  it("warn 行标为 warn", () => {
    const e = parseLine('[audio] could not enforce "Soundbar": busy (continuing)', "printer", NOW);
    expect(e?.level).toBe("warn");
  });

  it("普通 info 行返回 null", () => {
    expect(parseLine("[queue] claimed job 42", "printer", NOW)).toBeNull();
  });

  it("空行与无前缀行返回 null", () => {
    expect(parseLine("", "printer", NOW)).toBeNull();
    expect(parseLine("just some text", "printer", NOW)).toBeNull();
  });

  it("上报前脱敏", () => {
    const e = parseLine("[queue] failed for 0404978238", "printer", NOW);
    expect(e?.message).toBe("[queue] failed for <redacted:phone>");
  });

  it("service 透传（杯贴进程用 printer-cup-label）", () => {
    const e = parseLine("[cup-label/main] fatal: boom", "printer-cup-label", NOW);
    expect(e?.service).toBe("printer-cup-label");
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd ~/Github/mandys-selfheal/packages/agent && npx vitest run test/parse.test.ts
```

预期：FAIL，模块不存在

- [ ] **Step 4: 写 parse.ts**

```ts
import { type RawLogEvent, type Service, redact } from "@selfheal/core";

/**
 * printer-client 用 console.error / console.warn 打日志，行首固定是
 * `[module]`。launchd 把两者都写进同一个 .out.log，所以级别只能从
 * 文本本身推断——这些关键词就是 printer-client 里实际用的措辞。
 */
const ERROR_MARKERS = [
  "failed",
  "fatal",
  "uncaughtException",
  "unhandledRejection",
  "error",
  "refused",
  "timeout",
];
const WARN_MARKERS = ["could not", "skipping", "retrying", "stale"];

const PREFIXED = /^\[[\w./-]+\]/;

export function parseLine(line: string, service: Service, now: number): RawLogEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || !PREFIXED.test(trimmed)) return null;

  const lower = trimmed.toLowerCase();
  // warn 先判：`could not enforce ... (continuing)` 里也含 "could not"，
  // 但同一行若出现 error 关键词应升级为 error，故 error 判定放在后面覆盖。
  let level: "error" | "warn" | null = WARN_MARKERS.some((m) => lower.includes(m)) ? "warn" : null;
  if (ERROR_MARKERS.some((m) => lower.includes(m))) level = "error";
  if (level === null) return null;

  return { service, message: redact(trimmed), level, timestamp: now };
}
```

- [ ] **Step 5: 跑解析测试确认通过**

```bash
cd ~/Github/mandys-selfheal/packages/agent && npx vitest run test/parse.test.ts
```

预期：7 passed。注意 `[audio] could not enforce "Soundbar": busy (continuing)` 必须落在 warn——若被 error 关键词误升级，检查该行是否含 `error`/`failed`；本样本不含，应正常。

- [ ] **Step 6: 写失败的 tail 测试**

`packages/agent/test/tail.test.ts`：

```ts
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Tailer } from "../src/tail.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "selfheal-tail-"));
  file = join(dir, "test.log");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Tailer", () => {
  it("首次读取跳到文件末尾，不回放历史", async () => {
    writeFileSync(file, "old line 1\nold line 2\n");
    const t = new Tailer(file);
    expect(await t.read()).toEqual([]);
  });

  it("只返回新增行", async () => {
    writeFileSync(file, "old\n");
    const t = new Tailer(file);
    await t.read();
    appendFileSync(file, "new 1\nnew 2\n");
    expect(await t.read()).toEqual(["new 1", "new 2"]);
  });

  it("文件不存在时返回空数组不抛", async () => {
    const t = new Tailer(join(dir, "missing.log"));
    expect(await t.read()).toEqual([]);
  });

  it("文件被截断（logrotate）后从头读，不因偏移越界而永久沉默", async () => {
    writeFileSync(file, "aaaa\nbbbb\n");
    const t = new Tailer(file);
    await t.read();
    writeFileSync(file, "fresh\n");
    expect(await t.read()).toEqual(["fresh"]);
  });

  it("不返回未以换行结尾的半行，下次补齐后再返回", async () => {
    writeFileSync(file, "");
    const t = new Tailer(file);
    await t.read();
    appendFileSync(file, "half");
    expect(await t.read()).toEqual([]);
    appendFileSync(file, "-done\n");
    expect(await t.read()).toEqual(["half-done"]);
  });
});
```

- [ ] **Step 7: 跑 tail 测试确认失败**

```bash
cd ~/Github/mandys-selfheal/packages/agent && npx vitest run test/tail.test.ts
```

预期：FAIL，模块不存在

- [ ] **Step 8: 写 tail.ts**

```ts
import { open, stat } from "node:fs/promises";

/**
 * 按字节偏移增量读一个日志文件。
 *
 * 三个必须处理的现实情况：
 *  - 启动时不回放历史，否则每次重启都把陈年错误当新故障重报一遍
 *  - 文件被截断（logrotate / launchd 重建）后偏移会越界，必须复位，
 *    否则 agent 会永久沉默而看起来一切正常
 *  - 半行（写到一半的 console.error）不能上报，否则同一条错误会被
 *    切成两个不同指纹
 */
export class Tailer {
  private offset: number | null = null;
  private carry = "";

  constructor(private readonly path: string) {}

  async read(): Promise<string[]> {
    let size: number;
    try {
      size = (await stat(this.path)).size;
    } catch {
      return [];
    }

    if (this.offset === null) {
      this.offset = size;
      return [];
    }
    if (size < this.offset) {
      // 截断了，从头开始
      this.offset = 0;
      this.carry = "";
    }
    if (size === this.offset) return [];

    const handle = await open(this.path, "r");
    try {
      const length = size - this.offset;
      const buf = Buffer.alloc(length);
      await handle.read(buf, 0, length, this.offset);
      this.offset = size;

      const text = this.carry + buf.toString("utf8");
      const lines = text.split("\n");
      this.carry = lines.pop() ?? "";
      return lines;
    } finally {
      await handle.close();
    }
  }
}
```

- [ ] **Step 9: 跑测试确认通过并 commit**

```bash
cd ~/Github/mandys-selfheal/packages/agent && npx vitest run
cd ~/Github/mandys-selfheal && npm test && npm run lint && npx tsc --noEmit
git add packages/agent package.json package-lock.json
git commit -m "feat(agent): tail printer-client logs without replaying history

Resets the offset when the file shrinks. Without that, one logrotate
leaves the agent reading past EOF forever — silent, and indistinguishable
from a healthy shop."
```

---

### Task 12: agent — 上报与失败落盘

门店会断网。上报失败必须落盘重试，否则断网期间的错误全丢，而那正是最需要记录的时段。

**Files:**
- Create: `packages/agent/src/ship.ts`, `packages/agent/src/index.ts`
- Create: `packages/agent/test/ship.test.ts`

**Interfaces:**
- Consumes: `RawLogEvent`、`Tailer`、`parseLine`
- Produces:
  - `function signBody(body: string, secret: string): Promise<string>`
  - `class Shipper { constructor(opts: { url: string; secret: string; spoolPath: string }); ship(events: RawLogEvent[]): Promise<void> }`

- [ ] **Step 1: 写失败的测试**

`packages/agent/test/ship.test.ts`：

```ts
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawLogEvent } from "@selfheal/core";
import { Shipper } from "../src/ship.js";

let dir: string;
let spool: string;

const event: RawLogEvent = {
  service: "printer",
  message: "[queue] poll failed",
  level: "error",
  timestamp: 1_700_000_000_000,
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "selfheal-ship-"));
  spool = join(dir, "spool.ndjson");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function shipper() {
  return new Shipper({ url: "https://collector.test/ingest/agent", secret: "s3cret", spoolPath: spool });
}

describe("Shipper", () => {
  it("成功上报后不落盘", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await shipper().ship([event]);
    expect(existsSync(spool)).toBe(false);
  });

  it("带 HMAC-SHA256 签名头", async () => {
    const spy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await shipper().ship([event]);
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["x-selfheal-signature"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("网络失败则落盘", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ENETDOWN"); }));
    await shipper().ship([event]);
    expect(readFileSync(spool, "utf8").trim()).toBe(JSON.stringify(event));
  });

  it("非 2xx 也落盘", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await shipper().ship([event]);
    expect(existsSync(spool)).toBe(true);
  });

  it("下次成功上报时把落盘的一并带上并清空", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ENETDOWN"); }));
    await shipper().ship([event]);

    const spy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await shipper().ship([{ ...event, message: "[queue] second" }]);

    const body = JSON.parse(String((spy.mock.calls[0]?.[1] as RequestInit).body));
    expect(body).toHaveLength(2);
    expect(existsSync(spool)).toBe(false);
  });

  it("空事件且无积压时不发请求", async () => {
    const spy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await shipper().ship([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("积压超上限时丢最旧的，防止断网一夜撑爆磁盘", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ENETDOWN"); }));
    const s = shipper();
    for (let i = 0; i < 1200; i++) await s.ship([{ ...event, message: `[queue] ${i}` }]);
    const lines = readFileSync(spool, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1000);
    expect(lines[lines.length - 1]).toContain("1199");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ~/Github/mandys-selfheal/packages/agent && npx vitest run test/ship.test.ts
```

预期：FAIL，模块不存在

- [ ] **Step 3: 写 ship.ts**

```ts
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import type { RawLogEvent } from "@selfheal/core";

const MAX_SPOOL_LINES = 1000;

export async function signBody(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ShipperOptions {
  url: string;
  secret: string;
  spoolPath: string;
}

/**
 * 上报器。门店会断网，而断网时段恰恰最需要留下记录，所以失败一律
 * 落盘，下次连通时补发。
 *
 * 上限 1000 行、超了丢最旧的：断网一整夜也不会把 Mac mini 的磁盘写满。
 * 丢旧留新是因为最近的错误对判断当前状态更有用。
 */
export class Shipper {
  constructor(private readonly opts: ShipperOptions) {}

  async ship(events: RawLogEvent[]): Promise<void> {
    const backlog = this.readSpool();
    const all = [...backlog, ...events];
    if (all.length === 0) return;

    const body = JSON.stringify(all);
    try {
      const res = await fetch(this.opts.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-selfheal-signature": await signBody(body, this.opts.secret),
        },
        body,
      });
      if (!res.ok) throw new Error(`collector returned ${res.status}`);
      this.clearSpool();
    } catch {
      this.writeSpool(all);
    }
  }

  private readSpool(): RawLogEvent[] {
    if (!existsSync(this.opts.spoolPath)) return [];
    return readFileSync(this.opts.spoolPath, "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as RawLogEvent);
  }

  private writeSpool(events: RawLogEvent[]): void {
    const kept = events.slice(-MAX_SPOOL_LINES);
    writeFileSync(this.opts.spoolPath, kept.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }

  private clearSpool(): void {
    rmSync(this.opts.spoolPath, { force: true });
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ~/Github/mandys-selfheal/packages/agent && npx vitest run test/ship.test.ts
```

预期：7 passed

- [ ] **Step 5: 写 config.ts 与 index.ts**

`packages/agent/src/config.ts`：

```ts
import { homedir } from "node:os";
import { join } from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  collectorUrl: required("SELFHEAL_COLLECTOR_URL"),
  agentSecret: required("SELFHEAL_AGENT_SECRET"),
  pollMs: Number(process.env.SELFHEAL_POLL_MS ?? "5000"),
  spoolPath: process.env.SELFHEAL_SPOOL ?? join(homedir(), ".selfheal-spool.ndjson"),
  logs: [
    {
      path: join(homedir(), "Library/Logs/mandy-printer-client.out.log"),
      service: "printer" as const,
    },
    {
      path: join(homedir(), "Library/Logs/mandy-printer-client-cup-label.out.log"),
      service: "printer-cup-label" as const,
    },
  ],
};
```

`packages/agent/src/index.ts`：

```ts
import type { RawLogEvent } from "@selfheal/core";
import { config } from "./config.js";
import { parseLine } from "./parse.js";
import { Shipper } from "./ship.js";
import { Tailer } from "./tail.js";

const tailers = config.logs.map((l) => ({ ...l, tailer: new Tailer(l.path) }));
const shipper = new Shipper({
  url: config.collectorUrl,
  secret: config.agentSecret,
  spoolPath: config.spoolPath,
});

async function tick(): Promise<void> {
  const now = Date.now();
  const events: RawLogEvent[] = [];

  for (const { tailer, service } of tailers) {
    for (const line of await tailer.read()) {
      const event = parseLine(line, service, now);
      if (event) events.push(event);
    }
  }
  await shipper.ship(events);
}

// tick 自身抛异常会让 launchd 重启进程，而重启会丢掉 Tailer 的偏移、
// 回放行为回到「跳到末尾」——这正是我们要的，但不该因一次瞬时错误发生。
setInterval(() => {
  void tick().catch((err) => console.error("[selfheal-agent] tick failed:", err));
}, config.pollMs);

console.log(`[selfheal-agent] watching ${tailers.length} logs every ${config.pollMs}ms`);
```

- [ ] **Step 6: 跑全门禁并 commit**

```bash
cd ~/Github/mandys-selfheal && npm test && npm run lint && npx tsc --noEmit
git add packages/agent
git commit -m "feat(agent): spool to disk when the shop network is down

The outage window is exactly when losing logs hurts most, so failures
persist and go out on the next successful post. Capped at 1000 lines,
oldest dropped, so an overnight outage cannot fill the Mac mini's disk."
```

---

### Task 13: agent — 装到 Mac mini

**Files:**
- Create: `packages/agent/deploy/com.mandysbubbletea.selfheal-agent.plist`
- Create: `packages/agent/deploy/install.sh`
- Create: `packages/agent/README.md`

**Interfaces:**
- Consumes: Task 12 的 agent
- Produces: Mac mini 上常驻的 launchd job `com.mandysbubbletea.selfheal-agent`

- [ ] **Step 1: 写 plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.mandysbubbletea.selfheal-agent</string>

  <key>ProgramArguments</key>
  <array>
    <string>REPLACE_NODE</string>
    <string>--import</string>
    <string>tsx</string>
    <string>REPLACE_REPO/packages/agent/src/index.ts</string>
  </array>

  <key>WorkingDirectory</key>
  <string>REPLACE_REPO/packages/agent</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>SELFHEAL_COLLECTOR_URL</key>
    <string>REPLACE_COLLECTOR_URL</string>
    <key>SELFHEAL_AGENT_SECRET</key>
    <string>REPLACE_AGENT_SECRET</string>
  </dict>

  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>RunAtLoad</key>
  <true/>

  <key>StandardOutPath</key>
  <string>REPLACE_HOME/Library/Logs/selfheal-agent.out.log</string>
  <key>StandardErrorPath</key>
  <string>REPLACE_HOME/Library/Logs/selfheal-agent.err.log</string>
</dict>
</plist>
```

**注意**：secret 会明文落在 `~/Library/LaunchAgents/` 下的 plist 里。该目录权限为用户私有，且 Mac mini 是单用户机器；这是 launchd 传 env 的常规做法。安装脚本会 `chmod 600` 该文件。

- [ ] **Step 2: 写 install.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${SELFHEAL_COLLECTOR_URL:?set SELFHEAL_COLLECTOR_URL}"
: "${SELFHEAL_AGENT_SECRET:?set SELFHEAL_AGENT_SECRET}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.mandysbubbletea.selfheal-agent.plist"

sed -e "s|REPLACE_NODE|$(which node)|g" \
    -e "s|REPLACE_REPO|$REPO|g" \
    -e "s|REPLACE_HOME|$HOME|g" \
    -e "s|REPLACE_COLLECTOR_URL|$SELFHEAL_COLLECTOR_URL|g" \
    -e "s|REPLACE_AGENT_SECRET|$SELFHEAL_AGENT_SECRET|g" \
    "$REPO/packages/agent/deploy/com.mandysbubbletea.selfheal-agent.plist" > "$PLIST"

chmod 600 "$PLIST"
launchctl unload -w "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
echo "loaded. tail -f $HOME/Library/Logs/selfheal-agent.out.log"
```

- [ ] **Step 3: 本机试跑一遍（不装 launchd）**

```bash
cd ~/Github/mandys-selfheal/packages/agent
SELFHEAL_COLLECTOR_URL="https://mandys-selfheal-collector.<subdomain>.workers.dev/ingest/agent" \
SELFHEAL_AGENT_SECRET="<Task 10 Step 3 生成的 AGENT_SECRET>" \
npx tsx src/index.ts
```

预期：打印 `watching 2 logs every 5000ms`。另开一个终端造一条假错误：

```bash
echo "[queue] poll select failed (test): synthetic" >> ~/Library/Logs/mandy-printer-client.out.log
```

然后查 collector：

```bash
cd ~/Github/mandys-selfheal/packages/collector
npx wrangler d1 execute selfheal-incidents --remote \
  --command="SELECT service, count, substr(sample,1,60) FROM incidents WHERE service='printer' ORDER BY last_seen DESC LIMIT 3"
```

预期：能看到那条 synthetic 记录。

- [ ] **Step 4: 部署到 Mac mini**

SSH 到 Mac mini（走既有的 `com.mandysbubbletea.printer-tunnel` 通道），拉代码并安装：

```bash
git clone <repo-url> ~/Github/mandys-selfheal && cd ~/Github/mandys-selfheal && npm install
SELFHEAL_COLLECTOR_URL="https://.../ingest/agent" SELFHEAL_AGENT_SECRET="..." \
  bash packages/agent/deploy/install.sh
launchctl list | grep selfheal
tail -f ~/Library/Logs/selfheal-agent.out.log
```

- [ ] **Step 5: 断网演练**

在 Mac mini 上临时关掉 Wi-Fi/网线 2 分钟，期间往日志追加一条假错误，恢复网络后确认：

```bash
ls -l ~/.selfheal-spool.ndjson   # 断网期间应存在
# 恢复网络后约 5 秒
ls -l ~/.selfheal-spool.ndjson   # 应已被删除
```

再查 collector 确认那条记录补上来了。

- [ ] **Step 6: 写 README 并 commit**

`packages/agent/README.md` 记录：装/卸命令、两个 env 的来源、spool 文件位置、如何造假错误做冒烟。

```bash
cd ~/Github/mandys-selfheal
git add packages/agent
git commit -m "chore(agent): launchd job and install script for the Mac mini

chmod 600 on the plist because launchd env vars are the only way to hand
the agent its secret and that file ends up holding it in plain text."
```

---

### Task 14: poller — Supabase Logs API

**Files:**
- Create: `packages/poller/package.json`, `packages/poller/tsconfig.json`
- Create: `packages/poller/src/query.ts`, `packages/poller/src/index.ts`
- Create: `packages/poller/test/query.test.ts`
- Create: `.github/workflows/poller.yml`

**Interfaces:**
- Consumes: `RawLogEvent`、`redact`、`Shipper`（从 `@selfheal/agent` 复用）
- Produces:
  - `function parseSupabaseLogs(rows: unknown): RawLogEvent[]`
  - `function buildLogsQuery(sinceMs: number): string`

Supabase Management API 的 analytics 端点形如
`GET https://api.supabase.com/v1/projects/{ref}/analytics/endpoints/logs.all?sql=<urlencoded>`，
`Authorization: Bearer <management token>`。**此端点的响应形状需在 Step 5 用真实 token 核实一次**——它不在 Supabase 的稳定 API 契约内，形状变化不会有 deprecation 通知。

- [ ] **Step 1: 建包**

`packages/poller/package.json`：

```json
{
  "name": "@selfheal/poller",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "start": "tsx src/index.ts"
  },
  "dependencies": { "@selfheal/core": "*", "@selfheal/agent": "*" }
}
```

`packages/poller/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

```bash
cd ~/Github/mandys-selfheal && npm install
```

- [ ] **Step 2: 写失败的测试**

`packages/poller/test/query.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { buildLogsQuery, parseSupabaseLogs } from "../src/query.js";

describe("buildLogsQuery", () => {
  it("查询限定在 since 之后且只取错误级别", () => {
    const sql = buildLogsQuery(1_700_000_000_000);
    expect(sql).toContain("1700000000000000"); // 微秒
    expect(sql.toLowerCase()).toContain("where");
    expect(sql).toContain("limit");
  });
});

describe("parseSupabaseLogs", () => {
  it("把 result 数组映射成 RawLogEvent", () => {
    const out = parseSupabaseLogs({
      result: [{ event_message: "connection refused", timestamp: 1_700_000_000_000_000 }],
    });
    expect(out).toEqual([
      {
        service: "supabase",
        message: "connection refused",
        level: "error",
        timestamp: 1_700_000_000_000,
      },
    ]);
  });

  it("微秒时间戳转成毫秒", () => {
    const out = parseSupabaseLogs({
      result: [{ event_message: "x", timestamp: 1_700_000_000_123_456 }],
    });
    expect(out[0]?.timestamp).toBe(1_700_000_000_123);
  });

  it("上报前脱敏", () => {
    const out = parseSupabaseLogs({
      result: [{ event_message: "user stan@example.com missing", timestamp: 1_700_000_000_000_000 }],
    });
    expect(out[0]?.message).toBe("user <redacted:email> missing");
  });

  it("缺 result 字段返回空数组不抛", () => {
    expect(parseSupabaseLogs({})).toEqual([]);
    expect(parseSupabaseLogs(null)).toEqual([]);
  });

  it("跳过没有 event_message 的行", () => {
    expect(parseSupabaseLogs({ result: [{ timestamp: 1 }] })).toEqual([]);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd ~/Github/mandys-selfheal/packages/poller && npx vitest run
```

预期：FAIL，模块不存在

- [ ] **Step 4: 写 query.ts 与 index.ts**

`packages/poller/src/query.ts`：

```ts
import { type RawLogEvent, redact } from "@selfheal/core";

/**
 * Supabase 的日志表用微秒时间戳。cron 每 5 分钟跑一次，这里回看
 * 10 分钟：重叠部分由 collector 的指纹去重吃掉，宁可重复也不要
 * 因为 Actions 排队延迟而漏掉一个窗口。
 */
export function buildLogsQuery(sinceMs: number): string {
  const sinceUs = sinceMs * 1000;
  return `
    select event_message, timestamp
    from edge_logs
    where timestamp > ${sinceUs}
      and (event_message like '%error%' or event_message like '%failed%')
    order by timestamp desc
    limit 100
  `.trim();
}

interface Row {
  event_message?: unknown;
  timestamp?: unknown;
}

export function parseSupabaseLogs(body: unknown): RawLogEvent[] {
  const rows = (body as { result?: unknown } | null)?.result;
  if (!Array.isArray(rows)) return [];

  const out: RawLogEvent[] = [];
  for (const row of rows as Row[]) {
    if (typeof row.event_message !== "string" || row.event_message.length === 0) continue;
    out.push({
      service: "supabase",
      message: redact(row.event_message),
      level: "error",
      timestamp: Math.floor(Number(row.timestamp ?? 0) / 1000),
    });
  }
  return out;
}
```

`packages/poller/src/index.ts`：

```ts
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Shipper } from "@selfheal/agent/ship";
import { buildLogsQuery, parseSupabaseLogs } from "./query.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const LOOKBACK_MS = 600_000;

async function main(): Promise<void> {
  const ref = required("SUPABASE_PROJECT_REF");
  const token = required("SUPABASE_MANAGEMENT_TOKEN");

  const sql = buildLogsQuery(Date.now() - LOOKBACK_MS);
  const url = `https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`supabase logs api returned ${res.status}: ${await res.text()}`);

  const events = parseSupabaseLogs(await res.json());
  console.log(`[poller] ${events.length} events`);
  if (events.length === 0) return;

  // Actions runner 每次都是新容器，spool 落在 tmp 即可——重试由
  // 下一次 cron 的 10 分钟回看覆盖，不依赖磁盘持久化。
  await new Shipper({
    url: required("SELFHEAL_COLLECTOR_URL"),
    secret: required("SELFHEAL_AGENT_SECRET"),
    spoolPath: join(tmpdir(), "poller-spool.ndjson"),
  }).ship(events);
}

await main();
```

- [ ] **Step 5: 跑测试确认通过，再用真实 token 核实响应形状**

```bash
cd ~/Github/mandys-selfheal/packages/poller && npx vitest run
```

预期：6 passed。

然后**必须**用真实凭据核实一次端点形状（不进门禁，手动跑）：

```bash
SUPABASE_PROJECT_REF=fsvtwivogyebugqhmjjy
SQL=$(printf 'select event_message, timestamp from edge_logs order by timestamp desc limit 3')
curl -s -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/analytics/endpoints/logs.all?sql=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$SQL")" | head -40
```

若响应不是 `{ "result": [...] }`、或表名不是 `edge_logs`、或时间戳不是微秒，按实际形状改 `parseSupabaseLogs` 与 `buildLogsQuery`，并把真实响应片段加进测试固件。

- [ ] **Step 6: 写 GitHub Actions cron**

`.github/workflows/poller.yml`：

```yaml
name: poller
on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:

jobs:
  poll:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "npm" }
      - run: npm ci
      - run: npx tsx packages/poller/src/index.ts
        env:
          SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}
          SUPABASE_MANAGEMENT_TOKEN: ${{ secrets.SUPABASE_MANAGEMENT_TOKEN }}
          SELFHEAL_COLLECTOR_URL: ${{ secrets.SELFHEAL_COLLECTOR_URL }}
          SELFHEAL_AGENT_SECRET: ${{ secrets.SELFHEAL_AGENT_SECRET }}
```

- [ ] **Step 7: 配 secrets 并手动触发一次**

```bash
cd ~/Github/mandys-selfheal
gh secret set SUPABASE_PROJECT_REF --body "fsvtwivogyebugqhmjjy"
gh secret set SUPABASE_MANAGEMENT_TOKEN     # 交互输入
gh secret set SELFHEAL_COLLECTOR_URL --body "https://mandys-selfheal-collector.<subdomain>.workers.dev/ingest/agent"
gh secret set SELFHEAL_AGENT_SECRET         # 交互输入，与 Task 10 一致
gh workflow run poller.yml
gh run watch
```

预期：run 绿，日志打印 `[poller] N events`。

- [ ] **Step 8: 跑全门禁并 commit**

```bash
cd ~/Github/mandys-selfheal && npm test && npm run lint && npx tsc --noEmit
git add packages/poller .github/workflows/poller.yml
git commit -m "feat(poller): pull Supabase logs on a five-minute cron

Looks back ten minutes on a five-minute schedule. The overlap is absorbed
by the collector's fingerprint dedup, and Actions cron drifts often enough
that a non-overlapping window would silently skip one."
```

---

## 阶段 1 验收

四路全通后，连续观察 **3 天**再决定进阶段 2。逐项确认：

- [ ] `GET /health` 返回 `{"ok":true,"paused":false}`
- [ ] 主站与 admin 各自的错误都能在 D1 里查到，且 `service` 列区分正确
- [ ] Mac mini 的 printer 与 cup-label 两个日志都有记录进来
- [ ] poller 的 Actions run 连续三天无红
- [ ] 同一个反复出现的 error 在 D1 里是**一行**且 `count` 在增长，不是多行
- [ ] 钱路径的 error 在第一次出现时就收到了 Telegram
- [ ] 非钱路径的 error 在第三次出现时才收到 Telegram，且之后不再重复打扰
- [ ] `curl -X POST <url>/pause` 后新日志不再入库，`/resume` 后恢复
- [ ] 断网演练：spool 生成、恢复后清空、记录补齐
- [ ] 抽查 20 条 `sample`，确认无 token、无手机号、无邮箱漏网

**去重准确率是进阶段 2 的硬门槛。** 若同一故障被拆成多行，`normalize` 的规则需要按真实样本调整——阶段 2 的 healer 会为每个指纹开一个 PR，指纹不准就是 PR 泛滥。

## 未决事项（不阻塞本阶段）

- 澳洲 Privacy Act 下的 PII 出境披露：阶段 1 数据只进 Cloudflare D1（未出境到 LLM 供应商），但阶段 2 起日志会发往 DeepSeek，届时须先处理隐私政策
- L0 runbook（重启打印进程、重连 tunnel）：待去重准确率验证后，作为阶段 1.5 单独出计划
