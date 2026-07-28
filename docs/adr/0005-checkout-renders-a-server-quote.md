# ADR-0005 — 结账页渲染服务端 quote，不再自算价格

- 状态：Accepted
- 日期：2026-07-28
- 关联：#73（web）、[app#40](https://github.com/real-stanyan/Mandy-s-Bubble-Tea-App/issues/40)、推翻 ADR-0003 的临时处置
- 取代：`docs/adr/0003-checkout-preview-stays-a-client-mirror.md`（该 ADR 明确写了「下一步做服务端 quote 端点，届时两处镜像一起删」——本 ADR 就是那一步）

## 背景

web 和 app 的结账页各自用 TypeScript 复刻了一遍服务端的定价规则：welcome / IG follow / 会员 tier / diamond 免小料 / flash promo 的 exclusive better-of、以及 platform fee、card surcharge、public holiday surcharge 三个百分比费。

复刻件必然落后。app-download 20% 上线时两处镜像都不认识这张券，持券客户在结账页看到的是更小的 Welcome 券，总额偏高——这就是 #73 / app#40。ADR-0003 当时选择「先补镜像解除上线阻塞」，并把正解记在案。

## 决定

1. **`POST /api/orders` 的定价逻辑整体抽到 `src/lib/order-quote.ts` 的 `computeOrderPricing()`**——所有折扣、所有 service charge 的唯一决策点。抽出来是纯读的：不取号、不建单、不烧券，同一个购物车调两次答案相同。
2. **新增 `POST /api/orders/quote`**：请求体与建单**完全相同**（共用 `src/lib/order-request.ts` 的类型与校验），跑同一个 `computeOrderPricing()`，再交给 Square 自己的 `orders.calculate` 算总额。
3. **两端结账页只渲染，不自算**。折扣行的**名字也由服务端给**——只有服务端知道某张券覆盖了几杯、以及 exclusive better-of 谁赢了。
4. 两处客户端镜像连同 `tierCheckoutPreview` / `pickPromoCups` / `cardSurcharge` 等在结账页的调用**一并删除**。

## 为什么要多打一次 Square `orders.calculate`

不打这一次，服务端就得自己把百分比费乘出来——那还是镜像，只是从客户端搬到了服务端。`calculate` 用的是建单时同一套引擎、同一套舍入，quote 与实收因此是**同一个数**，不是「构造上应该相等」。

代价是每次报价一个 Square 往返。客户端 250ms 防抖 + 购物车不变不重取，一次结账通常 1–3 次。`calculate` 不创建任何东西。

失败时降级：本地按 bps 乘出来，结果标 `estimated: true`。少一分钱的摘要好过空白摘要。

## 过程中量到的两个既有事实错误

用生产 catalog 实测 `orders.calculate`（8 杯 × A$6.20，A$11.20 折扣）：

| | 无折扣 | 有折扣 |
|---|---|---|
| lineItem grossSalesMoney | A$49.60 | **A$38.40** |
| platform fee 0.5% | A$0.25 | **A$0.19** |
| card surcharge 1.9% | A$0.94 | **A$0.73** |
| order total | A$50.79 | A$39.32 |

1. **SUBTOTAL_PHASE 的百分比费按折后金额算**，不是折前。`/api/orders` 里原来的注释和两处客户端镜像都写反了——凡是有折扣的订单，页面显示的手续费都偏高。
2. **`calculate` 返回的 lineItem 金额已经扣过折扣**（gross 也是）。拿它当 subtotal 再单独列一行折扣 = 扣两次。所以 `subtotalCents` 取 `computeOrderPricing` 的目录价，不取 Square 的行项金额。

（无折扣那一列的 A$50.79 与 app#40 里记录的生产订单总额一致，可作交叉验证。）

## 后果

- 服务端加一张新券，两端结账页**无需改动**即可正确显示——这是本次改动真正买到的东西。
- `computeOrderPricing` 现在有 14 个单测覆盖折扣阶梯（welcome/IG/tier/flash/app-download 的 exclusive better-of、目录价优先于客户端价、菜单缓存挂掉时全部跳过）。这套规则此前**零测试覆盖**。
- 金额单位在 wire 上是**十进制字符串**（cents 是 BigInt，JSON 没有 BigInt）。客户端一律 `BigInt(...)` 解析，禁 `Number()`。
- 签出状态看不到 quote（端点要求登录），此时结账页退化为只显示购物车小计——偏高不偏低。
- 丢了一处细节：diamond 免小料行原来带「本月还剩 N 次」，现在只显示服务端给的「Diamond Free Toppings (N)」。要找回得把 `/api/tier/toppings` 的余额并进 quote。

## 什么时候该推翻

- Square 出了官方的「预览订单」端点能连 loyalty reward 一起算——那时 `rewardCupsSumCents` 这个 cheapest-N 估算也能删掉。
- 报价往返成为结账页的性能瓶颈（当前无证据）——那就把百分比费改成本地算、只在下单前校一次 `calculate`。

## 补记（2026-07-28，#83）——目录认不出的行，quote 拒答而不报价

本 ADR 落地后的真机走查暴露了一个本 ADR 自身引入的失效模式。

`authoritativeUnitPrice()` 对目录里不存在的 variationId 返回 `0n`，这是 create 路径上刻意的安全边界（模块头注释：绝不回落客户端价，否则伪造的 `variationPriceCents` 能把百分比折扣撑成免单）。当这个函数的答案是**折扣**时，0 只会让折扣变小，方向是安全的；当它的答案是**顾客要读的总价**时，0 意味着整单显示 A$0.00 —— 读起来就是"免单"。

结账页改为渲染 quote 之后，后者第一次成立。旧的客户端镜像遇到同样一份陈旧购物车会显示 A$56.00（它用的是购物车自己的价）。

生产上无需任何伪造即可到达：Square 里删掉再重建的商品会换 ID，而购物车持久化在 AsyncStorage / localStorage 里能存很久。

**决定**：目录**已加载**却认不出某一行时，`POST /api/orders/quote` 返回 409，不返回数字。两端结账页已有的「还没有 quote」回落路径接管，显示裸购物车 subtotal —— 宁高勿低。目录整体不可用（`priceMaps` 为 null）时维持原有的客户端价降级不变，那是另一条已写明的路径。

不改 `authoritativeUnitPrice` 的 0 语义。判据是**这个数字给谁看**：给折扣计算看，0 是安全的；给顾客看，就得先问一句能不能报。

只挡 variation，不挡 modifier：退役的小料只影响几十分钱，为它整片空掉结账摘要不划算（见 `src/lib/order-pricing.test.ts` 对应用例）。
