# Tier Card v2 — 虚拟实体会员卡（CSS 材质 + GSAP 动效）

Date: 2026-06-12 · Approved by Stan（v3 定稿）· Scope: Account 页 `LoyaltyCard` 纯前端升级

## Goal

把 Account 页会员卡升级为「虚拟实体卡」：dark-luxe CSS 材质 + 真卡构图 + GSAP 全套动态光效，桌面指针/手机陀螺仪双驱动。

> 迭代记录：①MiniMax 生图卡面（5 轮 prompt）→ Stan 否决「AI 感重、二维贴图」；②CSS 材质 v1/v2 → 「不够 premium」；③ v3 改构图（真卡比例/撤杯排/金属包边）定稿。教训：premium 来自构图与克制，不来自堆效果。

## 1. 卡面（`TIER_VISUALS`）

- **构图**：固定 1.6:1 信用卡比例（aspect-[1.6/1]），内容三段式 justify-between；40px 衬线大数字；3px 发丝进度条替代 StarCupsRow 杯排；细描边 tier 徽章 + View 钮；右下 5% 透明度衬线「M」压印；去 emoji
- **材质**（多层 background，自上而下）：左上 key light → 拉丝 grain → 底部 vignette → 深色金属底。银=石墨钢 / 金=暗香槟铜金 / 钻=墨黑 + 微弱刻面线
- **金属包边**：Link 外层 1.5px 渐变 rim（155deg 左上亮右下暗）+ 深投影；内层 bevel inset shadow
- **噪点**：SVG feTurbulence 层 mix-blend overlay 压渐变条带

## 2. GSAP 动效（`gsap` + `@gsap/react`，useGSAP + matchMedia）

- **进场**：rotationY -42°→0 + y + autoAlpha，power4.out 1.1s（transformPerspective 900）
- **反光呼吸**：整面 reflex 光带 idle 状态 7s sine 往返游移
- **桌面（pointer: fine）**：pointermove → quickTo rotationX/Y（±8/12°）+ reflex 绑定倾斜流动 + radial glare 跟指针 + 按压 scale 0.985
- **手机（coarse）**：`deviceorientation` 陀螺仪驱动同一套 applyTilt（首读数定基准，±28° 映射满偏）；iOS 13+ 在首次 touchend 静默 requestPermission；无陀螺仪/拒绝 → ±5° sway 悬浮摆动兜底
- **钻石**：conic 全息层 30s 慢旋（mix-blend overlay）+ 6 颗 ✦ 错峰 twinkle
- **降级**：matchMedia motionOK 条件包住全部动效；reduced-motion 全静态
- **生命周期**：`{ dependencies: [tier], revertOnUpdate: true, scope }`；监听器 contextSafe + cleanup
- **退役**：`useCardTilt.ts`、globals.css tier-shimmer/holo-pan/sparkle keyframes（confetti 保留）

## 3. 辅助

- `/dev/tier-cards` dev-only 预览路由（production 404），三 tier 一页眼验

## 4. 验收

1. 三 tier 卡面 premium 眼验通过（Stan v3 拍板）
2. 桌面 tilt/glare/reflex、手机陀螺仪/sway、进场、钻石 holo+sparkle 全部生效；reduced-motion 降级
3. vitest 全绿 + typecheck；dev server 无 console error
4. PR → preview green → merge → prod green
5. 已知 gap：iOS 真机权限弹窗流程无法本地模拟 → push /tester

## Execution

范围小（1 组件 + 1 dev 路由 + CSS 清理），inline 执行不开 subagent 流水线（Stan 批准，省 token）。
