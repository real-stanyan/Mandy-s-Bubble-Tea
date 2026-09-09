# 自愈告警进 Mandy's Admin App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把阶段 1 管线的告警出口从 Telegram 换成 Mandy's Admin App 的推送，并给这个目前只有脚手架的 app 装上它的第一个功能：收告警、看 incident 列表、随时暂停整条管线。

**Architecture:** collector（Cloudflare Worker）自己存 device token、自己签 APNS JWT、自己发推送——**不经过 Vercel、不经过 Supabase**。admin app 用一次性配对码认证，凭据存 Keychain。

**Tech Stack:** Cloudflare Workers + D1 + KV / SwiftUI iOS 17 + XcodeGen / APNS token-based auth（ES256）

**上游：** `docs/superpowers/plans/2026-08-07-selfheal-phase1-pipeline.md`（阶段 1，已完成 Task 1-12）

## 为什么 collector 自己发推送，而不是调主站现有的 APNS 代码

主站 `src/lib/wallet/apns.ts` 已经有一套跑在生产的实现，直接调它显然更省事。不这么做的理由只有一条，但足够：**告警链不能和被监控对象同生共死。** 主站挂了、Vercel 挂了、Supabase 挂了——那正是最需要通知你的时刻，而那时任何经过它们的告警都发不出去。

代价是 APNS 签名逻辑存在两处。这个重复是有意的，不要「优化」掉。

## Global Constraints

### collector（`~/Github/mandys-selfheal`）

- 包管理 **npm**；TypeScript **strict**（含 `noUncheckedIndexedAccess`）
- 门禁：`npm test` / `npm run lint` / `npx tsc --noEmit`，全绿才算完
- 测试**全离线**：APNS 一律走 `fetchMock`，禁打真实 Apple 端点（例外见 Task 1，那是一次性人工 spike）
- Secrets 只走 `wrangler secret`，禁硬编码、禁入 git
- eslint `@typescript-eslint/no-explicit-any: error`
- 时间一律 epoch 毫秒

### admin app（`~/Github/mandys_bubble_tea_admin_app`）

- Swift 5.9 / SwiftUI / iOS 17 / iPhone only
- **`.xcodeproj` 不进 git**，工程结构只改 `project.yml`，用 `xcodegen generate` 生成
- 门禁：`bash scripts/gate.sh`（= `xcodegen generate` + 模拟器上 `xcodebuild test`）
- **任何 token 不进 git、不进 UserDefaults——一律 Keychain**（该 repo 的 Hard rule）
- bundle id 固定 `com.mandybubbletea.adminapp`，team `HV982TTRNP`，不擅自改签名配置
- 协议类改动（AGENTS.md / Gate）走 L1，要 Stan 明确同意；本计划**不碰协议文件**

## 既有资产（不要重建）

- collector 已上线：`https://mandys-selfheal-collector.dryrun-agency.workers.dev`
- D1 `selfheal-incidents` = `ef50ef53-3bec-43f5-9300-03a71e8c1813`（悉尼）
- KV SWITCH = `5bc7e0120fed4bb883b8e5aae61fc89e`
- 已有 secret：`AGENT_SECRET`、`VERCEL_DRAIN_SECRET`
- `src/verify.ts` 已有 `timingSafeEqual` / `isAuthorized`（AGENT_SECRET）/ `hmacHex` / 两个签名校验
- `src/notify.ts` 已有 `notifyIncident`，含 4s 超时与「失败吞掉不拖垮 ingest」的语义——**这两条语义在换成 APNS 后必须原样保留**
- APNS 密钥：`~/Documents/AuthKey_HRPAMP2727.p8`，Key ID `HRPAMP2727`，Team `HV982TTRNP`
- 参考实现（**只读，不要 import**）：`~/Github/mandys_bubble_tea/src/lib/live-activity.ts` 的 ES256 签名与 APNS 请求头

## File Structure

```
mandys-selfheal/packages/collector/
├── migrations/0002_device_tokens.sql        新增
├── src/apns.ts                              新增 — ES256 JWT + 发推送
├── src/devices.ts                           新增 — token 增删与 410 清理
├── src/notify.ts                            改写 — Telegram → APNS
├── src/verify.ts                            追加 isAdmin()
├── src/index.ts                             追加 /devices 与 /incidents 路由
└── test/{apns,devices,notify,admin-api}.test.ts

mandys_bubble_tea_admin_app/
├── project.yml                              加 push 能力与 entitlements
├── MandysAdmin/
│   ├── MandysAdminApp.swift                 改 — AppDelegate 接管推送注册
│   ├── Keychain.swift                       新增 — 凭据存取
│   ├── CollectorClient.swift                新增 — 三个 API 调用
│   ├── Models.swift                         新增 — Incident
│   ├── PairingView.swift                    新增 — 首次配对
│   ├── IncidentListView.swift               新增 — 列表 + 下拉刷新
│   ├── SwitchToggleView.swift               新增 — kill switch
│   └── ContentView.swift                    改 — 按有无凭据分流
└── MandysAdminTests/                        对应单测
```

---

### Task 1: APNS 连通性 spike（先做，可能推翻架构）

APNS 要求 HTTP/2。Cloudflare Worker 的 `fetch` 能否直连 `api.push.apple.com` 没有被本项目验证过。**这一条不通，整个「Worker 直连 APNS」的架构就不成立**，必须在写任何 SwiftUI 之前知道。

**Files:** 无（一次性 spike，代码不落库）

- [ ] **Step 1: 把 APNS 凭据写进 Worker secret**

```bash
cd ~/Github/mandys-selfheal/packages/collector
npx wrangler secret put APNS_AUTH_KEY_P8 < ~/Documents/AuthKey_HRPAMP2727.p8
printf 'HRPAMP2727' | npx wrangler secret put APNS_KEY_ID
printf 'HV982TTRNP' | npx wrangler secret put APPLE_TEAM_ID
```

- [ ] **Step 2: 临时加一个 spike 路由**

在 `src/index.ts` 顶部路由里临时插入（**Step 5 必须删掉，不要 commit**）：

```ts
    if (request.method === "GET" && pathname === "/spike/apns") {
      const jwt = await buildApnsJwt(env);
      const res = await fetch("https://api.push.apple.com/3/device/0000000000000000000000000000000000000000000000000000000000000000", {
        method: "POST",
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-topic": "com.mandybubbletea.adminapp",
          "apns-push-type": "alert",
        },
        body: JSON.stringify({ aps: { alert: { title: "spike", body: "spike" } } }),
      });
      return Response.json({ status: res.status, body: await res.text() });
    }
```

`buildApnsJwt` 临时写在同文件里即可（Task 3 才正式落到 `src/apns.ts`）。

- [ ] **Step 3: 部署并打一发**

```bash
npx wrangler deploy
curl -s https://mandys-selfheal-collector.dryrun-agency.workers.dev/spike/apns
```

- [ ] **Step 4: 判读结果**

| 返回 | 含义 | 下一步 |
|---|---|---|
| `400` + `BadDeviceToken` | **成功**——连通、HTTP/2 可用、JWT 签名被 Apple 接受了。假 token 被拒是预期的 | 继续 Task 2 |
| `403` + `InvalidProviderToken` | 连通但 JWT 不对 | 核对 Key ID / Team ID / p8 是否完整（含 BEGIN/END 行） |
| `403` + `ExpiredProviderToken` | `iat` 时钟问题 | 检查 `iat` 是否用秒而非毫秒 |
| fetch 抛异常 / 网络错 | **架构不成立** | 停下，报 BLOCKED，把原始错误贴出来。备选方案见下 |

**若 APNS 直连不通**，备选按优先级：① Cloudflare Queues + 一个能发 HTTP/2 的 consumer；② 在 Mac mini agent 上做发送端（但门店断网时哑）；③ 退回主站 API（放弃解耦，最后手段）。**不要自行选定备选方案**——报 BLOCKED 让人决定。

- [ ] **Step 5: 删掉 spike 路由**

确认 `git status` 干净、`/spike/apns` 已从 `src/index.ts` 移除。这一步不 commit 任何东西。

---

### Task 2: D1 device_tokens 表与 isAdmin

**Files:**
- Create: `packages/collector/migrations/0002_device_tokens.sql`, `src/devices.ts`, `test/devices.test.ts`
- Modify: `src/verify.ts`, `src/switch.ts`（Env 加三个 APNS 字段与 ADMIN_TOKEN）

**Interfaces:**
- Produces: `isAdmin(request, env): boolean`；`registerDevice(env, token): Promise<void>`；`listDevices(env): Promise<string[]>`；`forgetDevice(env, token): Promise<void>`

- [ ] **Step 1: migration**

```sql
-- packages/collector/migrations/0002_device_tokens.sql
CREATE TABLE IF NOT EXISTS device_tokens (
  token       TEXT PRIMARY KEY,
  added_at    INTEGER NOT NULL,
  last_ok_at  INTEGER,
  last_error  TEXT
);
```

- [ ] **Step 2: Env 加字段**

`src/switch.ts` 的 `Env` 追加：

```ts
  ADMIN_TOKEN: string;
  APNS_AUTH_KEY_P8: string;
  APNS_KEY_ID: string;
  APPLE_TEAM_ID: string;
```

`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` 暂时保留（Task 5 删）。

- [ ] **Step 3: 写失败的测试**

`test/devices.test.ts`，schema 沿用阶段 1 各测试的 `beforeEach` 手动建表写法（同时建 `incidents` 与 `device_tokens`）：

```ts
describe("isAdmin", () => {
  it("正确的 ADMIN_TOKEN 通过", () => { /* Bearer env.ADMIN_TOKEN → true */ });
  it("AGENT_SECRET 不能当 ADMIN_TOKEN 用", () => { /* Bearer env.AGENT_SECRET → false */ });
  it("缺 header / 非 Bearer → false", () => {});
});

describe("device tokens", () => {
  it("注册一次后能列出来", async () => {});
  it("重复注册同一 token 不产生第二行", async () => {});
  it("forgetDevice 删掉它", async () => {});
  it("listDevices 空表返回 []", async () => {});
});
```

「`AGENT_SECRET` 不能当 `ADMIN_TOKEN` 用」这条是重点：Mac mini 上那份密钥泄漏时，不应该顺带能读取全部 incident 日志。两个凭据必须真的独立。

- [ ] **Step 4: 跑测试确认失败，然后实现**

`src/verify.ts` 追加（复用已有的 `timingSafeEqual`）：

```ts
/** 管理端凭据。与 AGENT_SECRET 分开：Mac mini 那份泄漏时不该顺带能读全部日志。 */
export function isAdmin(request: Request, env: Env): boolean {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  return timingSafeEqual(header.slice("Bearer ".length), env.ADMIN_TOKEN);
}
```

`src/devices.ts`：

```ts
import type { Env } from "./switch.js";

export async function registerDevice(env: Env, token: string, now: number): Promise<void> {
  await env.INCIDENTS.prepare(
    `INSERT INTO device_tokens (token, added_at) VALUES (?, ?)
     ON CONFLICT(token) DO NOTHING`,
  ).bind(token, now).run();
}

export async function listDevices(env: Env): Promise<string[]> {
  const { results } = await env.INCIDENTS.prepare(
    "SELECT token FROM device_tokens",
  ).all<{ token: string }>();
  return results.map((r) => r.token);
}

export async function forgetDevice(env: Env, token: string): Promise<void> {
  await env.INCIDENTS.prepare("DELETE FROM device_tokens WHERE token = ?").bind(token).run();
}
```

- [ ] **Step 5: 门禁绿 + commit**

```bash
git commit -m "feat(collector): store admin device tokens, on a credential of their own

ADMIN_TOKEN is separate from AGENT_SECRET so a leak of the Mac mini's
copy does not also hand over every captured production log line."
```

---

### Task 3: APNS 签名与发送

**Files:** Create `src/apns.ts`, `test/apns.test.ts`

**Interfaces:**
- `buildApnsJwt(env): Promise<string>` — 带 KV 缓存
- `sendApnsAlert(env, token, alert): Promise<number>` — 返回 HTTP 状态码

- [ ] **Step 1: 写失败的测试**（全部走 `fetchMock`，禁真连）

```ts
describe("buildApnsJwt", () => {
  it("产出三段式 JWT，header 含 ES256 与 kid", async () => {});
  it("第二次调用命中 KV 缓存，不重新签", async () => {});
});

describe("sendApnsAlert", () => {
  it("POST 到 /3/device/<token>，带 apns-topic 与 bearer", async () => {});
  it("410 Unregistered 时把该 token 从库里删掉", async () => {});
  it("Apple 返回 5xx 不抛异常", async () => {});
  it("网络失败不抛异常", async () => {});
});
```

- [ ] **Step 2: 实现**

```ts
const JWT_CACHE_KEY = "apns_jwt";
// Apple 要求 JWT 至少 20 分钟内不重签，超过 1 小时失效。55 分钟居中，
// 且不会因为每条告警都重签而触发 Apple 的 TooManyProviderTokenUpdates。
const JWT_TTL_S = 55 * 60;

function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function buildApnsJwt(env: Env): Promise<string> {
  const cached = await env.SWITCH.get(JWT_CACHE_KEY);
  if (cached) return cached;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(env.APNS_AUTH_KEY_P8),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64url(JSON.stringify({ alg: "ES256", kid: env.APNS_KEY_ID }));
  // iat 是秒不是毫秒——传毫秒 Apple 会回 ExpiredProviderToken，而错误信息
  // 不会告诉你原因。
  const payload = b64url(JSON.stringify({ iss: env.APPLE_TEAM_ID, iat: Math.floor(Date.now() / 1000) }));
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  // WebCrypto 的 ECDSA 输出就是 JWS ES256 要的裸 r||s，不需要再解 DER。
  const jwt = `${header}.${payload}.${b64url(sig)}`;
  await env.SWITCH.put(JWT_CACHE_KEY, jwt, { expirationTtl: JWT_TTL_S });
  return jwt;
}

export interface ApnsAlert {
  title: string;
  body: string;
  /** 点开通知后要跳到的 incident 指纹 */
  fingerprint: string;
}

const APNS_TIMEOUT_MS = 4000;

/**
 * 发一条推送。语义与阶段 1 的 notifyIncident 一致：**永不抛异常**，
 * 超时必须有——「连上了但不回」不抛，没有 AbortSignal 的话 await 会挂死，
 * 把一次通知故障放大成一次 ingest 故障。
 */
export async function sendApnsAlert(env: Env, token: string, alert: ApnsAlert): Promise<number> {
  try {
    const res = await fetch(`https://api.push.apple.com/3/device/${token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${await buildApnsJwt(env)}`,
        "apns-topic": "com.mandybubbletea.adminapp",
        "apns-push-type": "alert",
        "apns-priority": "10",
      },
      body: JSON.stringify({
        aps: { alert: { title: alert.title, body: alert.body }, sound: "default" },
        fingerprint: alert.fingerprint,
      }),
      signal: AbortSignal.timeout(APNS_TIMEOUT_MS),
    });
    // 410 = 这台设备卸载了 app 或 token 失效。留着它只会每次都失败一遍。
    if (res.status === 410) await forgetDevice(env, token);
    return res.status;
  } catch {
    return 0;
  }
}
```

- [ ] **Step 3: 测试绿 + 门禁绿 + commit**

---

### Task 4: notify.ts 换成 APNS

**Files:** Modify `src/notify.ts`；Rewrite `test/notify.test.ts`

- [ ] **Step 1: 改写测试**

保留阶段 1 那条最重要的断言——**Apple 挂了 `notifyIncident` 仍然 resolve**——并且必须用 `replyWithError` 而不是 5xx（`fetch` 只在传输层失败时 reject，5xx 会正常 resolve；用 5xx 的话把 try/catch 删了测试照样绿）。

新增：多设备时每台都发；没有任何设备时不发请求也不抛。

- [ ] **Step 2: 实现**

```ts
export async function notifyIncident(
  env: Env,
  event: RawLogEvent,
  result: RecordResult,
): Promise<void> {
  const title = `🔴 ${event.service}${result.count > 1 ? ` ×${result.count}` : ""}`;
  const body = [event.file, event.message.slice(0, 300)].filter(Boolean).join("\n");

  const tokens = await listDevices(env);
  // 逐台发而不是 Promise.all：设备数是个位数，串行的额外延迟可忽略，
  // 而并发下若某台触发 410 清理，会和其它请求抢同一行的写。
  for (const token of tokens) {
    await sendApnsAlert(env, token, { title, body, fingerprint: result.fingerprint });
  }
}
```

`notifyIncident` 的调用点（两个 ingest 分支）不变。

- [ ] **Step 3: 删掉 Telegram 残留**

`src/switch.ts` 的 `Env` 去掉 `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`；`vitest.config.ts` 的 bindings 同步去掉，加上 `ADMIN_TOKEN` 与三个 APNS 字段的假值。

- [ ] **Step 4: 门禁绿 + commit**

---

### Task 5: `/devices` 与 `/incidents` 路由

**Files:** Modify `src/index.ts`；Create `test/admin-api.test.ts`

- [ ] **Step 1: 写失败的测试**

```
POST   /devices    { token }   → 200，写库；无 ADMIN_TOKEN → 401
DELETE /devices    { token }   → 200，删除
GET    /incidents              → 200，按 last_seen 倒序，上限 50；无 ADMIN_TOKEN → 401
```

`GET /incidents` 的响应逐条含：`fingerprint / service / file / count / firstSeen / lastSeen / moneyPath / sample`。

**必须有一条断言：`AGENT_SECRET` 拿不到 `/incidents`。** 这是 Task 2 那条凭据隔离在路由层的落地，隔离只写在 `isAdmin` 里而路由用错函数，等于没做。

- [ ] **Step 2: 实现**，插在 `/ingest/*` 分支之后，404 之前。三个分支都先 `if (!isAdmin(request, env)) return new Response("unauthorized", { status: 401 });`

- [ ] **Step 2b: `/pause` `/resume` 同时接受 ADMIN_TOKEN**

原来只认 `AGENT_SECRET`，但 app 只持有 `ADMIN_TOKEN`——管理端 UI 的 kill switch 全会 401。这不是让某个凭据升权：暂停管线本来就是管理员动作，`AGENT_SECRET` 能按开关是历史遗留（Task 5 建开关时它是唯一凭据），保留它只为不破坏应急 curl 路径。

```ts
    if (request.method === "POST" && (pathname === "/pause" || pathname === "/resume")) {
      if (!isAuthorized(request, env) && !isAdmin(request, env)) {
        return new Response("unauthorized", { status: 401 });
      }
      ...
```

测试补两条：`ADMIN_TOKEN` 能 pause/resume；错凭据仍 401 且状态不变。

- [ ] **Step 3: 门禁绿 + commit**

---

### Task 6: 部署 + 端到端验证

- [ ] **Step 1: 生成并写入 ADMIN_TOKEN**

```bash
umask 077
openssl rand -hex 32 > ~/.mandys-selfheal/admin_token
chmod 600 ~/.mandys-selfheal/admin_token
cd ~/Github/mandys-selfheal/packages/collector
tr -d '\n' < ~/.mandys-selfheal/admin_token | npx wrangler secret put ADMIN_TOKEN
```

- [ ] **Step 2: 应用 migration 0002**（Management API 或 wrangler，前后各核验一次表是否存在）

- [ ] **Step 3: 部署，验 `/incidents` 401 与 200 两条路径**

- [ ] **Step 4: commit**

---

### Task 7: admin app — 推送能力与 entitlements

**Files:** Modify `project.yml`

- [ ] **Step 1: 加 entitlements 与后台模式**

```yaml
      entitlements:
        path: MandysAdmin/MandysAdmin.entitlements
        properties:
          aps-environment: production
      info:
        properties:
          UIBackgroundModes: [remote-notification]
```

- [ ] **Step 2: `xcodegen generate` + `bash scripts/gate.sh` 确认仍绿 + commit**

---

### Task 8: admin app — Keychain 与 CollectorClient

**Files:** Create `MandysAdmin/Keychain.swift`, `CollectorClient.swift`, `Models.swift`；对应测试

- [ ] **Step 1: 写失败的测试**

`Keychain`：存 / 取 / 删 / 取不存在的返回 nil。
`CollectorClient`：用 `URLProtocol` stub 断言请求带 `Authorization: Bearer`、路径正确、JSON 解码正确、非 200 抛错。

**不要**把凭据写进 `UserDefaults`——该 repo 的 Hard rule 明令 Keychain。

- [ ] **Step 2: 实现**。`CollectorClient` 三个方法：`registerDevice(token:)` / `fetchIncidents()` / `setPaused(_:)`。base URL 与 admin token 从 Keychain 读。

- [ ] **Step 3: 门禁绿 + commit**

---

### Task 9: admin app — 配对屏

**Files:** Create `PairingView.swift`；Modify `ContentView.swift`

- [ ] **Step 1:** 两个输入框（collector URL、admin token）+「连接」按钮。点击后调 `GET /incidents` 验证凭据，成功才存进 Keychain 并切到主界面，失败就地报错。

**验证后再存**是关键：存了错凭据的话，之后每一屏都会失败，而用户看不出是凭据错还是服务挂了。

- [ ] **Step 2:** `ContentView` 按 Keychain 里有没有凭据分流到 `PairingView` 或主界面。

- [ ] **Step 3: 门禁绿 + commit**

---

### Task 10: admin app — incident 列表与 kill switch

**Files:** Create `IncidentListView.swift`, `SwitchToggleView.swift`

- [ ] **Step 1: 列表**。每行：service、count、相对时间、`sample` 前两行。钱路径的行用品牌红 `#C43A10` 标记。下拉刷新。空态写「暂无 incident」而不是空白屏。

- [ ] **Step 2: kill switch**。一个 `Toggle`，状态取自 `GET /health` 的 `paused`。**打开暂停要二次确认**——它会让整条监控静默，误触的代价是你以为在监控其实没有。

- [ ] **Step 3: 门禁绿 + commit**

---

### Task 11: 推送注册与端到端

**Files:** Modify `MandysAdminApp.swift`（加 `AppDelegate`）

- [ ] **Step 1:** `UIApplicationDelegateAdaptor` + `didRegisterForRemoteNotificationsWithDeviceToken` → 转 hex → `CollectorClient.registerDevice`。在配对成功后才请求推送权限，不要一进 app 就弹。

- [ ] **Step 2: 真机验证**（模拟器收不到真实 APNS 推送）

装到你的 iPhone，配对，然后从任意机器造一条钱路径 error：

```bash
curl -s -X POST https://mandys-selfheal-collector.dryrun-agency.workers.dev/ingest/agent \
  -H "x-selfheal-signature: $(...)" \
  -d '[{"service":"web","message":"synthetic alert test","level":"error","timestamp":0,"file":"src/app/api/payment/route.ts"}]'
```

钱路径第一次出现就触发，推送应当几秒内到手机。

- [ ] **Step 3: 门禁绿 + commit**

---

## 验收

- [ ] Task 1 的 spike 拿到 `BadDeviceToken`（证明 Worker→APNS 通）
- [ ] `AGENT_SECRET` 拿不到 `/incidents`（凭据隔离真的生效）
- [ ] 卸载 app 后再触发告警，该 token 因 410 被自动清掉
- [ ] Apple 端点不可达时 `notifyIncident` 仍 resolve，ingest 不受影响
- [ ] 手机收到真实推送，点开能看到对应 incident
- [ ] kill switch 打开后新日志不入库，关闭后恢复

## 未决

- 阶段 1 剩下的 Task 13（Mac mini 部署）、Task 14（Supabase poller）与两条 Vercel Log Drain 仍未做，与本计划独立
- 多设备场景（Mandy 也要收告警）本计划支持，但没有「谁该收哪类告警」的分流，全部设备收全部告警
