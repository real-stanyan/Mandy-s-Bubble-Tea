# 图库图片二次处理 (Gallery Re-process) — Design

**Date:** 2026-06-20
**Repos:** `mandys_bubble_tea` (web, 主体) + `mandys_bubble_tea_admin` (admin UI)
**Builds on:** `2026-06-19-cup-label-gallery-admin-design.md` (v1/v2 — `gallery_presets` 表 + `cup-label-gallery` bucket + admin 管理页)

---

## 1. 目标

让 admin 对图库里**每一张图**做二次图像处理，把系统默认二值化得不理想的图修好。两条路径：

- **A. 调参重跑** — 对有彩色原图的 preset（235 图库内置 + 所有上传图），用一组「一键预设配方」重新二值化，实时预览，满意再保存。
- **B. 重传替换** — 对无彩色原图的 preset（38 招财猫内置，含截图抱怨的 `5ac8781655d0`，也可用于任意 preset），上传一张新的彩色源图替换，走同样的配方 + 预览流程。

两条路径共用同一套底层：**在 preset 现有 hash 下替换 `binarized.png`（B 还替换 `color.png`）产物 + 标记 override**，preset 身份（hash）不变。

### 约束 / 既成事实（实现者必读）
- 内置打印路径 `resolvePresetBuffer` / `getLuckyCatBinarized` 当前是**磁盘优先**，对 Supabase 故障有韧性。本设计**不能破坏这条韧性**：override 查询失败时必须优雅降级回磁盘（订单照常打印旧图，绝不阻塞下单）。
- `gallery_presets` 表里 235 图库内置 + 38 招财猫内置都已有 `source='builtin'` 的行（v2 已 seed）。
- 招财猫 38 张磁盘上**只有 `binarized.png` 没有 `color.png`**；彩色原图（曾在 `~/Desktop/招财猫/`）已永久丢失。因此 B 路径对它们是唯一出路。
- `RARE_LUCKY_CAT_HASH`（头奖猫）的 hash 是中奖逻辑的锚点。**重传替换头奖猫必须保留其原 hash**，绝不能因换图产生新 hash。
- hash = 原始字节的 md5，是 preset 身份。二次处理**不重算 hash**——同一 hash 下换产物。

---

## 2. 架构：磁盘种子层 + bucket 覆盖层

磁盘上的 `public/cup-label/{gallery,lucky-cat}/<hash>/binarized.png` 是**不可变种子**（Vercel 运行时只读，永不改）。任何二次处理结果写进 **Supabase bucket `cup-label-gallery/<hash>/`**，并在 DB 标 override。读取路径按 **「有 override → 读 bucket；没有 → 读磁盘」** 决议。

> 上传图（`source='upload'`）本来就只存在 bucket，读取已走 bucket，**不需要 override 概念**——重跑只是 upsert 覆盖 bucket 里的 `binarized.png`，零读取路径改动。**override 标记只对 `source='builtin'` 有意义。**

### 2.1 DB 迁移

`supabase/migrations/2026-06-20-gallery-presets-override.sql`：

```sql
alter table gallery_presets
  add column if not exists override_at timestamptz default null;
```

`override_at` 非空 ⟺ 该 hash 的 canonical `binarized.png`（及 `color.png`）在 bucket 里、磁盘种子作废。

### 2.2 读取路径优先级（三处）

| 函数 | 现状 | 改为 |
|---|---|---|
| `thumbUrlFor(row)` | builtin→磁盘 URL；upload→bucket color URL | builtin **且 override**→bucket `binarized.png` 公开 URL；builtin 无 override→磁盘（现状）；upload→bucket color（现状） |
| `resolvePresetBuffer(hash, opts?)` | 磁盘优先，catch→bucket | 传入 `{hasOverride}`：override→`downloadBucketBinarized`；否则磁盘优先 catch→bucket（现状） |
| `getLuckyCatBinarized(hash, opts?)` | 磁盘优先，catch→bucket | 同上 |

`thumbUrlFor` 的调用方（`listAllForAdmin`/`listVisiblePresets`）已从 DB 取行 → select 加上 `override_at` 即可，**零额外查询**。

打印路径的 `hasOverride` 来自调用方已有的 DB 读：
- **招财猫池**：`listLuckyCatPoolHashes` 已查 DB → 改为返回 `{ hash, hasOverride }[]`（select 加 `override_at`），传给 `getLuckyCatBinarized`。无新增韧性损失。
- **图库选中**：enqueue 路径新增一次**批量** `listPresetOverrides(hashes: string[]): Promise<Set<string>>`（单查询，`in (...)`）。DB 出错 → 返回空 Set（视作无 override）→ 退回磁盘 → 订单照常打印旧图。优雅降级。

---

## 3. 配方 (Recipes)

抽一个共享模块 `src/lib/cup-label/recipes.ts`，把 `scripts/process-lucky-cat-gallery.ts` 里的 `valueChannelPng` + `inkLineBinarized` 搬进来共享（脚本改为 import，行为不变——用 snapshot 锁定脚本输出不漂移）。

`RECIPES`：有序数组，每项 `{ id, label, run(source: Buffer): Promise<Buffer> /* binarized 592×592 1-bit png */ }`。

| id | label | 管线 | 适合 |
|---|---|---|---|
| `default` | 默认 | `binarizeForThermal(src, {mode:"atkinson"})`（= 现 `processGalleryImage`） | 多数照片 |
| `high-contrast` | 高对比 | sharp 拉对比度（`.normalise()` 或 `.linear(a,b)`）→ atkinson | 偏淡/发灰 |
| `bolder` | 加重(更黑) | sharp 预压暗（`.linear`/gamma）→ atkinson，更多像素落黑、线更粗 | 线太细太浅 |
| `ink-line` | 线稿提取 | `inkLineBinarized`（灰度→轻模糊→硬阈值→median 去噪） | 卡通/插画，丢彩色填充 |
| `drop-bg` | 去彩底 | `valueChannelPng`→`binarizeForThermal({mode:"threshold",threshold:200})` | 红底等饱和彩底 |

> 各配方的精确参数（对比度系数、gamma）在 plan 里用 snapshot 测试钉死；本节定义意图与管线来源。`high-contrast`/`bolder` 的对比度/亮度预处理是 `binarize` 之外新增的 sharp 步骤（`binarize` 本身只有 `mode`+`threshold`）。

color 缩略图：复用 `processGalleryImage` 的 480px 逻辑（抽成 `colorThumb(src)` 共享）。

---

## 4. 数据流

### 4.1 统一 commit 操作
两条路径殊途同归 = **「在已有 hash 下替换产物 + 标 override」**，只是 binarized 的*源*不同：

| | 源图来自 | 产 color.png？ |
|---|---|---|
| 调参重跑 (builtin gallery) | 磁盘 `gallery/<hash>/color.png` | 否（沿用磁盘 color；override 只换 binarized → 但 bucket 需 color 给 thumb，见下） |
| 调参重跑 (upload) | bucket `<hash>/color.png` | 否（沿用） |
| 重传替换 (cats / 任意) | 新上传的 raw | 是（新 raw → 新 color thumb） |

> 实现注意：override 后 `thumbUrlFor` 对 builtin 指向 **bucket** `binarized.png`，所以 commit 必须保证 bucket 里那张 `binarized.png` 存在。color 是否写 bucket：调参重跑 builtin 时把磁盘 color.png 一并 copy 进 bucket（让未来 upload 型 thumb 逻辑统一），重传时写新 color。简化规则：**commit 永远 `uploadBucketArtifacts(hash, color, binarized)` 两个都写**，color 取「新上传的」或「现有源 color」。

### 4.2 API（web，复用现有鉴权 `isAuthedGalleryAdmin`）

新增 `POST /api/admin/gallery/reprocess`，`runtime=nodejs`：

**预览**（不落库）`{ hash, recipeId, image? }` →
- `image` 给了（重传）→ 源 = decode(image)；否则（重跑）→ 服务端按 hash 取现有源 color（builtin gallery 读磁盘 `color.png`；upload 读 bucket `color.png`；builtin cat 无源 → `400 needs_upload`）。
- 跑 `RECIPES[recipeId].run(源)` → 回 `{ binarizedDataUrl, colorDataUrl }`，不写任何东西。

**保存**（落库）同 body + `commit:true` →
- 同上得到 binarized + color → `uploadBucketArtifacts(hash, color, binarized)` → set `override_at=now()`（`update gallery_presets`）→ 回 `{ ok, hash }`。
- 重传替换：preset 行已存在（builtin cat），只 update override_at；hash 不变 → 头奖猫 hash 安全。

`恢复默认` `DELETE /api/admin/gallery/[hash]/override`（仅 builtin 有意义）→ 清 `override_at`（可选删 bucket 产物）→ 读取路径回退磁盘种子。

### 4.3 admin 侧（`src/lib/gallery.ts` + actions + GalleryGrid）
- `src/lib/gallery.ts` 加 `reprocessPreview(hash, recipeId, image?)` / `reprocessCommit(...)` / `restoreDefault(hash)` server caller（转发到 web，跨域，Bearer），thumbUrl 绝对化逻辑沿用。
- `AdminPreset` 加 `hasOverride: boolean`（web `/api/admin/gallery` 返回 `override_at` → 映射）。
- `actions.ts` 加 `reprocessAction` / `restoreDefaultAction`，`getAuthedAdmin` 守卫。

---

## 5. UI（admin `GalleryGrid.tsx` PresetCard）

每张卡新增一个「图片处理」按钮（与现有 隐藏/删除 并排），点开一个 modal：

```
┌── 图片处理 ──────────────────────────────┐
│  [换一张源图 ⬆]  ← file input（招财猫必须先点这个）│
│                                            │
│  当前              预览                     │
│  ┌──────┐        ┌──────┐                  │
│  │binariz│  →    │ 实时  │                  │
│  └──────┘        └──────┘                  │
│                                            │
│  配方: [默认][高对比][加重][线稿][去彩底]      │
│                                            │
│  [保存]   [恢复默认]   [取消]                │
└────────────────────────────────────────────┘
```

- 点配方 → 调 `reprocessPreview` → 右侧实时预览（builtin cat 无源时配方按钮禁用，提示「请先换一张源图」）。
- 「保存」→ `reprocessCommit` → 刷新该卡 thumb。
- 「恢复默认」→ 仅 `source==='builtin'` 显示；`restoreDefault` → 回磁盘种子。
- 「换一张源图」→ 任意卡可用；招财猫卡打开时默认聚焦此处。

单一 modal 覆盖 A+B 两路径——有源直接配方，无源先上传。

---

## 6. 真·联动不变量

- override 后**打印的就是新图**：`resolvePresetBuffer`/`getLuckyCatBinarized` 读 bucket 新 binarized（已在 §2.2）。仅改 thumb 不改打印 = bug。
- 重传招财猫后该猫仍在抽奖池里、hash 不变（池来自 DB `kind='lucky_cat'`，与 override 正交）。头奖猫重传后仍是头奖。
- 恢复默认后打印回到磁盘原图。
- Supabase 全挂：override 查询降级 → 打印磁盘种子 → 订单不阻塞。

---

## 7. 测试

- **配方确定性**：5 个配方各喂一张固定测试图 → snapshot 锁定 1-bit 输出。
- **脚本不漂移**：`process-lucky-cat-gallery` 改 import 共享管线后，对同一输入输出与重构前一致（snapshot）。
- **override 读取优先级**（3 路径各一）：有 override → bucket 新图；无 → 磁盘种子；override 查询抛错 → 降级磁盘。
- **hash 稳定**：重传替换（含头奖猫 hash）前后 preset hash 不变。
- **API**：鉴权（401/500）；预览不落库；保存写 bucket + set override_at；builtin cat 无源预览 → 400 needs_upload；恢复默认清 override_at。
- **池正交**：重传/恢复不影响 `listLuckyCatPoolHashes` 的池成员与头奖判定。

---

## 8. 不做 (YAGNI)

- 不做客户侧任何改动（客户 picker 只读 thumb + 打印，自动受益于 override）。
- 不做批量二次处理（逐张足够；批量上传是 v1 的事）。
- 不做自定义滑块/数字调参（一键配方覆盖需求；未来要再加）。
- 不尝试找回 38 招财猫原图（用户自行翻废纸篓/时间机器，找回与否本设计都成立）。
- 不改 `binarize.ts` 公开签名（高对比/加重的预处理在 recipes 层用 sharp 完成）。
