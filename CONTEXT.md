# Domain context — Mandy's Bubble Tea

领域词汇表。所有 agent 对业务词的理解以此为准；代码命名与这里的术语保持一致。新术语出现时补进来（起始版由代码 + `.claude/*.md` 提炼，发现偏差以代码行为为准并回改这里）。

## Terms

| 术语 | 定义 | 备注 |
|---|---|---|
| star（⭐ 星） | loyalty 单位。1 杯 = 1 星，跨全部 7 个品类 | 9 星 = 免单一杯（任选）。规则在 Square Dashboard 配 |
| 品类（category） | MILKY / FRUITY / SPECIAL MIX / FRESH BREW / FRUITY BLACK TEA / FROZEN / CHEESE CREAM | 共 7 类 |
| tier（会员等级） | 消费额累积的会员分级，享折扣/特权 | wallet + POS 折扣统一走 tier |
| `drinks_remaining` | 会员钱包里剩余可兑的免费饮品数 | 补偿 bug 用它 backfill，不退现金 |
| loyalty accrual | 下单后给顾客加星/积分的过程 | 有 backfill 脚本处理漏记 |
| welcome discount | 新用户入会首单折扣（曾做过 2 杯版） | promo 的一种 |
| flash promo | 单日限时促销（如全单 20% off），与其它折扣**互斥**取最优单一折扣 | uid 不能带冒号，否则 Square 400 |
| tasting promo（尝新券） | 新品在时间窗内按固定"尝新价"卖（如 $5），**仅 App**，每单限 1 杯，配料另计 | `tasting_promos` 表；与其它折扣互斥取最优（ADR-0009） |
| promo 互斥 | 多个可用折扣时只取最优的一个，不叠加 | |
| cup-label / doodle | 杯贴：顾客涂鸦 / gallery 贴纸 / AI 图 / 默认兜底，热敏打印到杯子 | `src/lib/cup-label/`、`src/lib/doodle/` |
| binarize | 把彩色图转成热敏打印用的黑白点阵（"打印效果"） | `binarize.ts`，`BINARIZE_PIPELINE=v2` 可选实验管线 |
| gallery override | 管理员对内置 gallery 贴纸的重处理覆盖版，存 bucket | `override_at` 时间戳；缩略图 `?v=` 破缓存 |
| thumbUrl WYSIWYG | 缩略图显示 binarized 打印效果（`binarized.png`），不显示彩色源 | upload/builtin 都如此 |
| Live Activity（LA） | iOS 灵动岛/锁屏实时订单卡片，靠 ActivityKit token 推送 | `live-activity-webhook.ts` |
| order-card push | Android 常驻卡片镜像。**在 LA-token gate 之前**独立 fetch 订单（安卓无 LA token） | `order-card-push.ts` |
| 三态取餐 | pickup LA 三状态：RESERVED→preparing，PREPARED→ready，COMPLETED→completed | |
| POS backup mode | 线上下单转 POS 备份的开关（`app_settings.pos_backup_mode`） | Square 宕机兜底 |
| wallet pass | Apple/Google 钱包会员卡 | `src/lib/wallet/` |
| `creation_source=MERGE` | Square 自动建的 customer 记录（LOYALTY/MERGE），早于 complete-signup | 别拿 customerCreated 当发放门，用幂等 upsert |
| printer-client | Mac mini 常驻打印客户端（热敏小票 + 杯贴），SSH tunnel 回连 | `printer-client/` |
| customer note（杯贴 Note） | 结账页「Note for the barista」；随 `/api/orders` 写进每个 Square line item 的 `note`，杯贴底部信息带以 `Note:` 打出，配料永不为它截断（先缩字号，再缩 note） | `src/lib/cup-label/label-note.ts`、`layoutBottomBand`；老订单回落解析取餐备注 `"<单号> — <note>"`，配送单备注不解析 |
| serializeSquareResponse | 返回 Square 数据前的 BigInt 序列化包装，防 JSON 炸 | 见 `.claude/square-api.md` |

## Key invariants

- `AGENTS.md` 永远是唯一规则源；根 `CLAUDE.md` 永远只是 `@AGENTS.md` 空壳，`.claude/CLAUDE.md` 永远只是指路表——两者都不复述规则（ADR-0010）
- 不建 `HANDOFF.md`——交接走 issue comment（append-only、带时间戳）
- 门禁命令在 AGENTS.md 和 `.github/workflows/ci.yml` 里必须字面一致（CI == Gate 契约）
- 一个任务一个 agent 做完，交接只在任务边界发生
- 钱一律 cents + BigInt；secrets 只走 env；vitest 默认套件全离线——详见 AGENTS.md Hard rules
