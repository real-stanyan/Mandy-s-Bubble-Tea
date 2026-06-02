# Checkout Doodle + 杯标打印机替换 设计文档

**Date**: 2026-04-27
**Author**: Stan + Claude (brainstorm session)
**Status**: 设计阶段 — 待 plan / 实施
**Scope**: APP only（`mandys_bubble_tea_app` RN/Expo + `mandys_bubble_tea` Vercel backend）

---

## 0. 背景与动机

现状：店内用 Zebra ZD411 打 40×30mm 杯标（OL号 + 杯名 + 配料）。客户在 app 下单流程缺少"个性化"互动；杯标也只是纯文本，跟 HEYTEA 那种"画涂鸦印杯子"的体验差距明显。

目标：客户在 RN app checkout 页**每杯**画一幅黑白涂鸦（可选，不画用默认池随机一张），下单后涂鸦连同 OL号/杯名/配料以三明治布局印在 50×80mm die-cut 标签上贴杯子。

附带硬件目标：把 Zebra ZD411 整体替换为 Star TSP100IV SK（80mm die-cut，CloudPRNT 直连 WiFi），从打印链路里移除 Mac mini 中转。Mac mini 保留做语音叫号 + admin UI，仅杯标路径独立。

---

## 1. 决策日志（来自 brainstorm Q1-Q11）

| Q | 问题 | 选择 | 备注 |
|---|------|------|------|
| Q1 | 涂鸦颗粒度 | A — 每杯一张 | 多杯订单每杯独立 |
| Q2 | 必填还是可选 | C — 可选，跳过用默认池 | |
| Q3 | 何时画 | a — 付款前 | |
| Q4 | UI 入口形态 | B — Checkout 页 section | |
| Q5 | 默认池规模 | b — 5-10 张 | v1 用 4-5 张起步 |
| Q6 | 默认图分配 | b — 随机 + 稳定 seed | `hash(lineId, cupIdx) % POOL.length` |
| Q7 | 工具集 | b — 笔（3档粗细） + 撤销 + 清空 | 不做颜色、图层、橡皮 |
| Q8 | 标签 layout | C — 三明治：OL/杯名顶反白 / doodle 中 / modifiers 底 | 50×80mm |
| Q9 | 硬件路线 | a — TSP100IV 取代 ZD411，**无热备** | 已知风险，接受 |
| Q10 | 默认池来源 | a + e — 用 Mandy 现有 IP，设计师定制延后 | |
| Q11 | RN 画板库 | B — `react-native-svg` + `PanResponder` | OTA 友好，零 native 改动 |

---

## 2. 架构总览

```
┌──────────────────────────┐
│  RN App (Expo)           │
│  ─ Checkout screen       │
│    └─ DoodleSection      │
│       └─ DoodleModal     │
│          └─ DoodleCanvas │
│             (svg paths)  │
└──────────┬───────────────┘
           │ POST /api/doodle/upload (svg paths JSON)
           │ POST /api/orders        (orderItems + doodleIds)
           ▼
┌──────────────────────────┐         ┌─────────────────────┐
│  Vercel (Next.js)        │ ──────▶ │ Supabase            │
│  ─ /api/doodle/upload    │         │  ─ doodles table    │
│  ─ /api/orders           │         │  ─ print_jobs table │
│  ─ /api/cloudprnt/poll   │         │  ─ Storage:         │
│  ─ /api/cloudprnt/ack    │         │     doodles/        │
│  ─ Vercel Cron (24h GC)  │         │     doodles_pool/   │
└────────────┬─────────────┘         └─────────────────────┘
             │
             │  HTTP poll every 5s
             │  (Star CloudPRNT)
             ▼
   ┌─────────────────────────────┐
   │  Star TSP100IV SK (in-store)│
   │  WiFi → Vercel              │
   │  50×80mm die-cut thermal    │
   └─────────────────────────────┘

[ Mac mini 保留：语音叫号 + admin UI 3001 + heartbeat — 不在杯标路径 ]
[ Zebra ZD411 物理收柜 — zpl.ts 留作冷备 reference ]
```

**核心解耦**：杯标完全走 Vercel ↔ TSP100 直连；Mac mini 只负责非杯标周边职责。

---

## 3. Frontend (RN App)

### 3.1 改动范围

| 文件 | 动作 |
|------|------|
| `app/checkout.tsx` | 在 Order Summary 上方插入 `<DoodleSection />` |
| `components/doodle/DoodleSection.tsx` | **新建**：横排 N 个杯子缩略图 |
| `components/doodle/DoodleModal.tsx` | **新建**：全屏 RN `<Modal>`，含画板 + 工具栏 |
| `components/doodle/DoodleCanvas.tsx` | **新建**：`<Svg>` + `<Path>` + `PanResponder` |
| `lib/doodle/pool.ts` | **新建**：默认池配置 + `pickDefaultForCup` |
| `lib/doodle/cartToSlots.ts` | **新建**：cart line × qty → DoodleSlot[] |
| `lib/doodle/uploadDoodle.ts` | **新建**：上传 svg paths JSON 到 Vercel |

### 3.2 数据形态（client）

```ts
type DoodleSlot = {
  lineId: string;        // 来自 cart line
  cupIdx: number;        // 0..qty-1
  drinkName: string;     // "Pearl Milk Tea"
  defaultUrl: string;    // 池里抽的稳定默认图
  userPaths: SvgPath[] | null;  // null = 用默认；非空 = 用户画了
};

type SvgPath = { d: string; stroke: string; width: number };
```

`DoodleSlot[]` 是 cart 派生态；不动 cart 数据模型，结账时才物化。

### 3.3 用户交互

```
Checkout 页
├─ DoodleSection（顶部）
│  └─ 横滑缩略图：[Cup1 🌸 默认] [Cup2 ✓ 已画] [Cup3 + 画一下]
│        点击 → 打开 DoodleModal(slot=Cup1)
│
└─ DoodleModal（全屏）
   ├─ 顶栏：杯名 + ✕ 关闭 + ✓ 完成
   ├─ Canvas：svg 画板（200×320pt 模拟 50×80mm 比例）
   ├─ 工具栏：[笔粗 3档] [黑色] [撤销] [清空] [使用默认]
   └─ 翻杯：← Cup 1/3 →
```

### 3.4 PanResponder + SVG 绘制

```tsx
const [paths, setPaths] = useState<SvgPath[]>([]);
const currentPath = useRef<string>('');

const responder = PanResponder.create({
  onStartShouldSetPanResponder: () => true,
  onPanResponderGrant: (e) => {
    const {locationX, locationY} = e.nativeEvent;
    currentPath.current = `M${locationX},${locationY}`;
  },
  onPanResponderMove: (e) => {
    const {locationX, locationY} = e.nativeEvent;
    currentPath.current += ` L${locationX},${locationY}`;
  },
  onPanResponderRelease: () => {
    setPaths(p => [...p, {d: currentPath.current, stroke: '#000', width: brush}]);
    currentPath.current = '';
  },
});

<Svg {...responder.panHandlers} viewBox="0 0 400 640">
  {paths.map((p, i) => (
    <Path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  ))}
</Svg>
```

性能预算：奶茶杯涂鸦 < 80 笔，svg 渲染 60fps 没问题。

### 3.5 提交时序

1. 用户点 "Pay"
2. 对每个 `userPaths !== null` 的 slot：`POST /api/doodle/upload` body `{lineId, cupIdx, paths}`
3. 后端：svg → render PNG → 1-bit raster → Supabase Storage → 返回 `doodleId`
4. App 收齐 `doodleIds[]`，连同 cart `POST /api/orders`
5. `userPaths === null` 的 slot 由服务端用 `pickDefaultForCup` 自动填默认图

**Web checkout**：不显示 DoodleSection，所有 slot 服务端自动走默认池。

---

## 4. Backend + Database

### 4.1 新增/改动文件（Vercel `mandys_bubble_tea`）

| 文件 | 动作 |
|------|------|
| `src/app/api/doodle/upload/route.ts` | **新建** |
| `src/app/api/cloudprnt/poll/route.ts` | **新建** |
| `src/app/api/cloudprnt/ack/route.ts` | **新建** |
| `src/app/api/orders/route.ts` | **改**：order 创建关联 doodleIds |
| `src/lib/doodle/render.ts` | **新建**：svg → PNG → 1-bit raster |
| `src/lib/doodle/pool.ts` | **新建**：服务端默认池（同前端 hash） |
| `src/lib/star/raster.ts` | **新建**：Star ESC/GS 命令拼装 |
| `src/lib/cup-label/render-tsp100.ts` | **新建**：sandwich layout 渲染 |
| `supabase/migrations/2026XXXX_doodle.sql` | **新建** |

### 4.2 数据库

```sql
create table doodles (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  line_id text not null,
  cup_idx int not null,
  source text not null check (source in ('user', 'default')),
  svg_paths jsonb,           -- user 画的；default 为 null
  default_key text,          -- default 池 key；user 为 null
  png_path text not null,    -- Supabase Storage path
  raster_path text not null, -- 1-bit Star raster bin path
  created_at timestamptz default now(),
  printed_at timestamptz,
  cleanup_at timestamptz default (now() + interval '24 hours')
);

create index on doodles (order_id);
create index on doodles (cleanup_at) where printed_at is not null;

create table print_jobs (
  id uuid primary key default gen_random_uuid(),
  doodle_id uuid references doodles(id),
  status text default 'pending',  -- pending | printing | done | failed
  attempts int default 0,
  raster_path text not null,
  created_at timestamptz default now(),
  printed_at timestamptz
);

create index on print_jobs (status, created_at);

alter table cup_labels add column doodle_id uuid references doodles(id);
```

### 4.3 Storage

Supabase bucket `doodles/`：
- `{orderId}/{lineId}_{cupIdx}.png`（203 DPI 渲染图，调试 / 预览）
- `{orderId}/{lineId}_{cupIdx}.bin`（Star raster 二进制）

bucket `doodles_pool/`：部署时预渲染好的默认池 raster。

### 4.4 渲染管线

```
SVG paths (JSON)
   ↓ resvg-js（pure JS）
PNG @ 203 DPI 405×405px (50mm 中间区域)
   ↓ sharp.threshold(128).raw()
1-bit bitmap
   ↓ src/lib/cup-label/render-tsp100.ts 合成 sandwich
完整 50×80mm 标签 raster (400×640 dots, ~32KB)
   ↓ src/lib/star/raster.ts 拼 ESC/GS 命令
存 Storage → 触发 print_jobs
```

`render-tsp100.ts` 输出整张标签 raster，包括：
- 顶 12mm（96 dots）：OL号 + 杯名（**反白**），sharp 合成文字位图
- 中 45mm（360 dots）：doodle PNG
- 底 23mm（184 dots）：modifiers，sharp 合成文字位图

字体打包：`Inter-Bold.ttf`（OL/杯名）+ `Inter-Regular.ttf`（modifiers）。

### 4.5 默认池

```ts
// src/lib/doodle/pool.ts （前后端镜像）
const POOL = [
  { key: 'bunny', svg: '...' },
  { key: 'flower', svg: '...' },
  { key: 'star', svg: '...' },
  { key: 'cloud', svg: '...' },
];

export function pickDefaultForCup(lineId: string, cupIdx: number): PoolItem {
  const seed = hash(`${lineId}:${cupIdx}`);
  return POOL[seed % POOL.length];
}
```

默认图 raster 部署时**预渲染**好存 `doodles_pool/`，运行时直接复制 path 引用，不重新渲染。

### 4.6 Cleanup

Vercel Cron 03:00 每天：
```sql
DELETE FROM doodles
WHERE printed_at IS NOT NULL
  AND cleanup_at < now();
```
+ 删 Storage 文件。未打印的（printed_at IS NULL）保留。

---

## 5. Hardware & 打印管线

### 5.1 硬件清单

| 设备 | 角色 | 状态 |
|------|------|------|
| Star TSP100IV SK | 杯标主机（**唯一**） | 新购 ~$649 AUD |
| 50×80mm 三防 die-cut 热敏纸 | 耗材 | 淘宝 ¥7.2/卷，多卷囤货 |
| Mac mini | 语音叫号 + admin UI 3001 + heartbeat | 保留，**不在杯标路径** |
| Zebra ZD411 | 完全下线 | 收柜冷备（无热备） |

### 5.2 CloudPRNT 拉模型

```
Star TSP100  ── poll every 5s ──▶  Vercel /api/cloudprnt/poll
            ◀─── job (raster) ───
            ─── ack ────────────▶  Vercel /api/cloudprnt/ack
```

打印机自带 WiFi 模块；CloudPRNT URL 配 `https://mandys.../api/cloudprnt/poll`。完全不经 Mac mini。

### 5.3 API 契约

#### `POST /api/cloudprnt/poll`
打印机 POST，body 含 `printerMAC`。

有任务（HTTP 200）：
```
Content-Type: application/vnd.star.starprnt
[Star raster 二进制]
X-Star-Job-Token: {jobId}
```

无任务（HTTP 200）：
```json
{ "jobReady": false }
```

#### `POST /api/cloudprnt/ack`
Body：`{ jobToken, status: "ok"|"error", code }`
- `ok` → `UPDATE doodles SET printed_at = now()` + `print_jobs.status = 'done'`
- `error` → `attempts += 1`，最多重试 3 次后标记 `failed`

### 5.4 Star Raster 命令

```ts
// src/lib/star/raster.ts
export function buildLabelJob(rasterBitmap: Buffer, widthDots: number, heightDots: number) {
  return Buffer.concat([
    Buffer.from([0x1B, 0x40]),                    // ESC @ initialize
    Buffer.from([0x1B, 0x1D, 0x61, 0x01]),        // 启用 gap sensor (die-cut)
    Buffer.from([0x1B, 0x2A, 0x72, 0x41]),        // 进入 raster mode
    Buffer.from([0x1B, 0x2A, 0x72, 0x59]),        // 设置宽度
    encodeWidth(widthDots),
    rasterBitmap,                                  // 1-bit data
    Buffer.from([0x1B, 0x2A, 0x72, 0x42]),        // 退出 raster mode
    Buffer.from([0x1B, 0x64, 0x02]),              // form feed to next gap
  ]);
}
```

50×80mm @ 203 DPI = 400×640 dots，1-bit = 32KB。

### 5.5 标签 layout（sandwich, 50×80mm）

```
┌────────────────────────────┐
│ ▓▓▓ OL856 · 1/2     ▓▓▓▓▓ │ 12mm 反白条 (96 dots)
│ ▓▓▓ Pearl Milk Tea L ▓▓▓ │
├────────────────────────────┤
│         🐰 doodle          │
│                            │ 45mm (360 dots)
│                            │
├────────────────────────────┤
│ Pearl×2 · Aloe             │
│ 50%S · Warm                │ 23mm (184 dots)
│ Almond Milk                │
└────────────────────────────┘
```

### 5.6 打印机一次性配置

到货后：
1. 装 50×80mm 卷纸 → 按 FEED 校准 gap sensor
2. 长按 FEED 进 setup mode → 浏览器访问打印机 IP
3. CloudPRNT URL: `https://mandys.../api/cloudprnt/poll`
4. Polling 间隔: 5s
5. admin UI 触发 test label 验证

### 5.7 Mac mini 不变的部分

- `printer-client/` 目录保留（zpl.ts 标 `@deprecated` 但不删）
- 语音叫号、3001 admin UI、heartbeat 不动
- ZD411 物理收柜，**不在生产路径**

---

## 6. 风险登记

| # | 风险 | 概率 | 影响 | 缓解 |
|---|------|------|------|------|
| 1 | TSP100IV 故障无热备 | 中 | 🔴 全店停杯标 | 已知接受。zpl.ts 留 reference；故障 30min 切回 ZD411；备 1 卷纸；heartbeat 失联 5min 报警 |
| 2 | CloudPRNT 网络波动 | 中 | 🟡 打印延迟 | poll 5s + 队列模型容错 |
| 3 | Star raster 错位 | 中 | 🟡 印歪/印不全 | 上线前打 50+ 张校准；render 函数 unit test 对比 golden raster |
| 4 | gap sensor 不识别 die-cut | 低 | 🟡 连续走纸 | 配置时跑校准；纸张统一供应商 |
| 5 | doodle PNG 渲染慢拖累 checkout | 低 | 🟡 用户等 | 异步 worker；order 入库即返回 |
| 6 | resvg-js / sharp Vercel cold start | 中 | 🟡 首单慢 3-5s | 预热路由 + `maxDuration: 30` |
| 7 | 用户画恶意/不雅内容 | 低 | 🟢 印杯子上 | v1 不审核；店员可手动重打默认；v2 加 mod review |
| 8 | App OTA 推 doodle bug | 低 | 🟢 | 纯 JS（svg + PanResponder），OTA 完全可推 |
| 9 | ASC review 撞档 1.0.7/1.0.6 | 中 | 🟡 | doodle 单独排 1.0.8；不混进现有 build |
| 10 | TSP100 + ZD411 同时被店员误用 | 低 | 🟢 | 物理：装 TSP100 当天收 ZD411 入柜 |

---

## 7. 上线 Checklist

### 阶段 0 — 准备（无代码）
- [ ] 下单 Star TSP100IV SK
- [ ] 淘宝下 50×80mm 三防 die-cut 标 2-3 卷
- [ ] 等 1.0.7 / 1.0.6 都过 ASC review

### 阶段 1 — 后端 + 默认池（先跑通无 UI 链路）
- [ ] Supabase migration（doodles + print_jobs + cup_labels.doodle_id）
- [ ] `lib/doodle/pool.ts` + 4 张默认 svg
- [ ] `lib/doodle/render.ts`（resvg + sharp + threshold）
- [ ] `lib/star/raster.ts` + golden test
- [ ] `lib/cup-label/render-tsp100.ts`（sandwich layout）
- [ ] `/api/cloudprnt/poll` + `/api/cloudprnt/ack`
- [ ] 新订单服务端自动给每杯分配默认图——**无 app UI**，所有订单印默认池图
- [ ] 打印机到货 → 配 CloudPRNT URL → 真订单稳跑 1 周

### 阶段 2 — App UI（doodle 入口）
- [ ] `lib/doodle/cartToSlots.ts` + `lib/doodle/pool.ts`（前端镜像 hash）
- [ ] `DoodleCanvas` + `DoodleModal` + `DoodleSection`
- [ ] checkout screen 集成
- [ ] `/api/doodle/upload`（接 svg paths → 渲染 → Storage）
- [ ] order 创建带 doodleIds
- [ ] EAS Build → 内测
- [ ] 上 ASC 1.0.8

### 阶段 3 — 清理 + 监控
- [ ] Vercel Cron 24h cleanup
- [ ] heartbeat 监控（TSP100 失联 5min → Slack 报警）
- [ ] ZD411 物理收柜
- [ ] `printer-client/src/zpl.ts` 标 `@deprecated`

---

## 8. 不做的（YAGNI）

- ❌ 颜色（v1 只黑色）
- ❌ 图层 / 橡皮擦（清空就够）
- ❌ 用户画作审核
- ❌ "我的画作历史"页面
- ❌ 分享到社交
- ❌ 默认池设计师定制（Q10 选 e：延后）
- ❌ Web 端涂鸦（Q11 选 a：app only）
- ❌ Skia 画板（Q11 选 B：svg + PanResponder，OTA 友好）
- ❌ TSP100 热备机（Q9 选 a，已知风险）
