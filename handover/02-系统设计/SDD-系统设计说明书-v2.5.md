<!-- 由 tools/html2md.js 从 SDD-系统设计说明书-v2.3.html 自动转换；v2.4 的增补内容为手工追加（源 HTML 未重出），改动集中在版本头、6.4、8.1、16.5、11、14 与末页 -->

TIDEGLASS · System Design

# 系统设计说明书 System Design Document · 技术架构、数据模型、接口与部署

- **文档编号**：TG-SDD-001
- **版本**：v2.5（商品编辑器与文件存储补齐）
- **编写日期**：2026-11-14
- **上游文档**：TG-FRD-001 功能需求说明书 v2.7
- **适用对象**：开发、运维、后续接手者
- **本轮交付**：设计方案 + 已交付实现（`app/server`）的对齐说明

> **v2.5 变更摘要**：新增**文件存储**这一层。此前系统是纯"单 JSON 文件"形态，商品图只能靠仓库里的静态资源，后台无法上传。
>
> ① 新增 `lib/uploads.js`——base64 落盘、文件头嗅探（不认扩展名）、路径穿越防护、孤儿文件清理；
> ② 新增 `lib/csv.js`——RFC 4180 子集解析器（逐字符扫描，不用 `split(',')`）、模板生成（带 UTF-8 BOM）；
> ③ `index.js` 拆出 `/uploads/*` 独立静态路由，**不走 SPA 兜底**（否则图片 404 会返回一段 HTML）；
> ④ 请求体上限从"全站 256 KB"改为"默认 256 KB + 上传接口 8 MB"，避免给全站开口子；
> ⑤ 第 8.1 节补充：数据卷里除了 `db.json` 还多了 `uploads/` 目录，迁移与备份要一起带走。
>
> 设计取舍：图片上传**不走 multipart**。现有 `readBody` 是 JSON 解析器，自己写 multipart 解析器约 60 行且边界多；改为前端 Canvas 压缩后转 base64 走 JSON，图片 200–400 KB，代价是体积膨胀 1.35 倍，收益是零新增解析代码、且用户传原图时自动变小。

> **v2.4 变更摘要**：这一版不新增设计，只做**文档与已交付代码的对齐**，把"按文档做"和"已经在跑的"之间的四类偏差修掉：
> ① **接口清单**——第 6 节写的是方案 A（Next.js）的路径风格，实际交付的是 `/api/v1/*`，新增 6.4 节给出 48 路径 / 56 操作的双向对照；
> ② **权限位清单**——16.5 节原先写 `reviews:write` / `audit:read`，与 `lib/auth.js` 的 `ALL_PERMISSIONS` 不符（这是 D-015 的复发风险），按实现更正为 10 位，并补"新增模块复用既有权限位"的约定；
> ③ **后台模块数**——演进路线里的"12 个后台模块"改为实际交付的 13 个（新增集合 / 内容 / 定制需求单）；
> ④ **部署形态**——第 8 节描述的是 Coolify + PostgreSQL，而当前交付版是单机 Node + JSON，新增 8.1 说明单实例硬约束与"上生产要换什么"。
>
> 另外补 5.3「启动时轻量迁移」，说明老数据文件缺字段时 `normalize()` 如何补齐——这决定了升级代码时数据文件要不要手工改。

> **v2.3 变更摘要**：编码前把「文档怎么规定」与「服务端怎么做」逐项对齐，新增第 16 节**服务端实现契约**——把原先散落在需求里的 8 条约束固化成可测试的接口行为：定价只在服务端发生、报价锁、幂等下单、状态机、权限位、库存流水、乐观锁、限流与统一错误结构。同时**更正表数量**：正文标题写 35 张，实际逐节点数为 **37 张**（「评价与运营」组标注 7 张，实际 9 张），已改。这两处都是"照文档做会做错"的问题，所以在开发启动前修掉。

> **v1.1 变更摘要**：新增营销引擎（优惠券 / 自动折扣 / 满额赠品 / 叠加计算）、评价与审核、库存占用、定制需求单、到货提醒五块设计；数据模型从 12 张表扩到 **25 张**；补**需求追溯矩阵**、**邮件模板表**、**埋点表**、**定时任务表** 四张清单；修正 v1.0 的费率快照缺失问题。

## 1 文档说明

本文回答"这套系统怎么搭、数据怎么存、接口怎么定、上线放哪里、出问题怎么查"。所有关键决策都给出**选项对比 + 建议 + 待确认标记**，不默认你已经同意某一个方案。

与 FRD 的关系：FRD 定义"做什么"，本文定义"怎么做"。凡是本文出现的技术选择，若与你的预期冲突，以你的确认为准，改文档成本远低于改代码。

## 2 架构总览

### 2.1 分层结构

- **访问层**：Cloudflare / CDN · HTTPS · WAF 基础防护
- **应用层**：**前台服务（SSR）** · **后台服务（SPA + API）** · 静态资源
- **领域层**：商品与变体 · 集合与导航 · 购物车 · 订单与状态机 · 库存与占用 · 客户 · 内容 · **营销引擎** · **评价与审核** · 定制单
- **数据层**：**PostgreSQL** · 对象存储（商品图） · Redis（可选缓存）
- **外部服务**：Stripe 支付 · Resend 邮件 · 海外仓 / 物流 · GA4 + 错误监控

### 2.2 两个前端形态

| 形态 | 使用方 | 渲染方式 | 为什么这样选 |
| --- | --- | --- | --- |
| 前台商城 | 消费者 | 服务端渲染（SSR）+ 少量客户端脚本 | 商品页要能被 Google 收录，首屏要快；交互只在加购、抽屉、筛选处增强 |
| 后台管理 | 你 / 运营 | 单页应用 + JSON API | 不需要 SEO，追求操作不刷新、切页快 |

两者共用同一套领域逻辑与数据库，避免"前台一套规则、后台一套规则"导致数据对不上——这是上一版最需要避免的问题。

## 3 技术选型

### 3.1 三个候选方案

| 方案 | 构成 | 优点 | 代价 | 适合场景 |
| --- | --- | --- | --- | --- |
| **A（建议）** 自建全栈 | Next.js + Prisma + PostgreSQL + Stripe + Resend，部署在 Coolify | 完全可控、无平台抽成、结构随意扩展、SEO 友好 | 需要自己维护服务器与备份 | 长期做品牌、SKU 会持续增加 |
| B 轻量自建 | Node 原生服务 + 单文件 JSON 存储 | 极轻、启动快、零依赖、改起来最快 | 并发与数据量上限低；多人同时改易冲突 | 纯演示 / 内部评审 原型阶段用过 |
| C 平台托管 | Shopify + 主题定制 | 交易、支付、物流生态成熟，几乎不用写代码 | 月费 + 交易抽成；深度定制受限；数据不在自己手里 | 想最快开店、不打算做特殊流程 |

> **建议：A。**理由：你的 100 款 SKU 与多轴集合体系需要自定义数据结构；后台的成本拆解、定制单这类需求平台方案做不了；长期看自建的可控性更重要。若你更看重"最快上线"，C 也成立，但要接受抽成与定制上限。

### 3.2 具体技术清单（方案 A）

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | Next.js（App Router） | SSR + 静态生成混合，前台页面按需选择 |
| 语言 | TypeScript | 订单、金额相关逻辑必须有类型约束 |
| 样式 | Tailwind CSS + 少量自定义 CSS 变量 | 设计规范沉淀在 token 里，改色改字号集中可控 |
| 数据库 | PostgreSQL 16 | 订单与库存需要事务；JSON 字段可存变体快照 |
| ORM | Prisma | 迁移可追溯，schema 即文档 |
| 支付 | Stripe（Embedded Checkout） | 卡号不进入我们服务器，PCI 责任转移给 Stripe |
| 邮件 | Resend | 事务邮件（订单确认、发货、退款） |
| 图片 | 对象存储 + CDN，输出 WebP/AVIF | 统一 4:5 裁切，多尺寸响应式 |
| 部署 | Coolify（Docker）+ Nginx | 一台 2C4G 起步够用，后续可水平扩展 |
| 监控 | 访问日志 + 错误监控 + 支付失败告警 | 先保证"能发现问题" |

## 4 模块划分

| 模块 | 职责 | 对外提供 | 依赖 |
| --- | --- | --- | --- |
| catalog | 商品、变体、集合、导航、搜索 | 列表、详情、筛选、搜索 | DB |
| cart | 购物车增删改、算价、免邮判断 | cart API | catalog |
| checkout | 地址校验、运费与税、创建支付意图、回调处理 | checkout API、webhook | cart、payment、inventory |
| order | 订单生成、状态机、发货、退款登记 | admin order API | checkout、inventory、mail |
| inventory | 库存读写、扣减与回滚、低库存预警 | 内部服务 | DB |
| customer | 由订单聚合客户、分层、查询 | admin customer API | order |
| content | 首页区块、内容页、公告栏 | 前台读取、后台编辑 | DB |
| auth | 后台登录、会话、限流 | admin auth API | DB |
| mail | 模板管理与发送 | 内部服务 | Resend |
| promotion | 营销引擎：优惠券校验、自动折扣、赠品判定、叠加与优先级计算 | 前台结算、后台营销中心 | order、inventory |
| review | 评价提交、审核状态机、评分聚合、删除留痕 | 前台评价区、后台审核 | order |
| reservation | 库存占用：写入、转实扣、超时释放 | 内部服务 + 定时任务 | inventory、order |
| custom | 定制需求单：提交、状态流转 | 前台 S-09、后台 A-12 | mail |
| notify | 到货提醒名单：收集、去重、批量通知 | 内部服务 | mail、inventory |

模块之间只通过定义好的函数/接口通信，不跨模块直接读对方表，避免后期耦合。

> **为什么单独抽 promotion 模块**：优惠计算是这套系统里**最容易出错、也最影响钱**的一段逻辑（自动折扣 + 优惠券 + 免邮 + 赠品四步串联，顺序错了金额就错）。把它做成纯函数式的模块——输入购物车与活动列表，输出「折扣明细 + 赠品清单 + 应付金额」——可以被单元测试完全覆盖，也能被结算页、订单创建、后台改单三处复用同一份逻辑，不会出现"前台显示 $72、后台算出 $75"的对不上账。

**v2.1 新增两个模块**：`growth`（弃购、邀评、归因编排，只做流程串联不做业务计算）与 `mail`（模板渲染 + 频次限流 + 发送日志；**限流在这里统一做，各业务模块不得自行发信**）。归因的采集埋点在 `analytics`，报表在后台读取。

## 5 数据模型

### 5.1 实体关系

```
Collection ──< CollectionProduct >── Product ──< Variant
                                          │
                                          ├──< ProductImage
                                          └──< Review

Order ──< OrderItem (快照: 标题/价格/变体/成本)
  │   └── costSnapshot (JSON: 下单瞬间的全部费率)
  ├──< OrderAdjustment (优惠明细: 自动折扣 / 券 / 赠品)
  ├──< PaymentRecord
  ├──< StatusLog
  └──< AfterSale (退货 / 换新 / 部分退款)

Coupon ──< CouponRedemption >── Order
Promotion (自动折扣)   GiftRule (满额赠品 → 指向 Variant)
Variant ──< StockReservation (占用 → Order)

Review ──< ReviewAudit (通过/拒绝/删除留痕)
CustomRequest   NotifyRequest   EmailTemplate   JobRun
Customer 1──< Order (以邮箱识别)   Setting (单行)   ContentBlock / ContentPage

AbandonedCart (弃购 · 按 email)   EmailLog (发送日志)   MarketingConsent (订阅授权)   ChannelCost (渠道花费)

User (账户) ──< Session (会话)
  ├──< Address
  ├──< WishlistItem >── Product
  └─(email)─> Order   ← 归属靠邮箱匹配，不设外键：访客订单要先能存在，用户后才注册
```

### 5.2 核心表（37 张）

#### 商品与内容（7 张）

| 表 | 关键字段 | 索引 / 约束 |
| --- | --- | --- |
| Product | id、handle（唯一）、title、description、status、price、compareAtPrice、cost、tags、seoTitle、seoDesc、birthstone（枚举，可空）、createdAt | handle 唯一；status + createdAt；birthstone |
| Variant | id、productId、sku（唯一）、metal（gold / silver）、size、price、**onHand**、**reserved**、safetyStock、weight | sku 唯一；productId；（onHand − reserved）不得为负，由事务保证 |
| ProductImage | id、productId、url、alt、position | productId + position |
| Collection | id、handle（唯一）、title、description、isNav、parentId、menuGroup、position、ruleJson | handle 唯一；isNav + position |
| CollectionProduct | collectionId、productId、position | 联合主键 |
| ContentBlock | key（唯一）、type、payloadJson、updatedAt | key 唯一 |
| ContentPage | slug（唯一）、title、bodyHtml、seoTitle、seoDesc | slug 唯一 |

#### 交易与库存（7 张）

| 表 | 关键字段 | 索引 / 约束 |
| --- | --- | --- |
| Order | id、number（唯一）、email、status、**orderType（sale / exchange / reship / gift）**、**subtotal**、**discountTotal**、shipping、tax、total、currency、addressJson、shippingMethod、trackingNo、carrier、**costSnapshot(JSON)**、**couponCode**、**giftJson**、createdAt、paidAt | number 唯一；email + createdAt；status |
| OrderItem | id、orderId、productId、variantId、titleSnap、variantSnap、unitPrice、qty、costSnap、**isGift**、**lineDiscount** | orderId；isGift 赠品行 unitPrice=0 但 costSnap 不为 0 |
| OrderAdjustment | id、orderId、type（promotion / coupon / gift / shipping）、refId、label、amount（赠品为负成本）、createdAt | orderId + type；一笔订单可有多个 adjustment |
| PaymentRecord | id、orderId、provider（stripe）、intentId、amount、status、rawJson、createdAt | intentId 唯一（幂等） |
| StatusLog | id、orderId、from、to、note、operator、createdAt | orderId + createdAt |
| StockReservation | id、variantId、orderId、qty、status（held / committed / released）、expiresAt、createdAt | variantId + status；expiresAt 索引供定时任务扫描 |
| AfterSale | id、orderId、type（return / exchange / partial）、reason、itemsJson、amount、status、operator、**restockDecision（restock / scrap / return_to_supplier）**、**restockedQty**、createdAt | orderId + type；与订单状态正交 |

#### 营销（4 张）

| 表 | 关键字段 | 索引 / 约束 |
| --- | --- | --- |
| Coupon | id、code（唯一）、type（percent / fixed / freeship）、value、minSubtotal、scope（all / collection / product）、scopeIds、startsAt、endsAt、totalLimit、perUserLimit、usedCount、stackable、channel、status | code 唯一；status + startsAt + endsAt |
| CouponRedemption | id、couponId、orderId、email、amount、**revokedAt（退款回退时写入）**、createdAt | couponId + email（校验 perUserLimit，**须排除 revokedAt 非空**）；orderId 唯一 |
| Promotion | id、name、scope、scopeIds、type（percent / fixed）、value、startsAt、endsAt、priority、showCompareAt、budget、spent、status | status + startsAt + endsAt；priority 降序取首个命中 |
| GiftRule | id、threshold（分）、giftVariantIds（JSON，可多选一）、perOrderQty、stockLimit、usedCount、copyText、startsAt、endsAt、status | status + startsAt + endsAt |

#### 账户与权限（4 张 · v2.0 新增）

| 表 | 关键字段 | 索引 / 约束 |
| --- | --- | --- |
| User | id、email（唯一）、passwordHash（argon2id）、name、**role**（customer / staff / owner）、**permissions**（JSON 数组，权限位）、status（active / disabled）、createdAt、lastLoginAt | email 唯一且**入库前统一小写**（否则 A@x.com 与 a@x.com 会变成两个账户，订单归属立刻错）；role + status |
| Session | id、userId、tokenHash（唯一）、userAgent、ip、expiresAt、revokedAt、createdAt | tokenHash 唯一（库里只有哈希，泄库不能直接冒用）；expiresAt 索引供清理任务；同一用户允许多设备会话 |
| Address | id、userId、first、last、line1、line2、city、state、zip、country、phone、isDefault | userId + isDefault；每个用户至多一个默认地址（部分唯一索引保证） |
| WishlistItem | id、userId、productId、createdAt | userId + productId 唯一（重复收藏靠 upsert 幂等） |

#### 账务与一致性（2 张 · v2.2 新增）

| 表 | 关键字段 | 索引 / 约束 |
| --- | --- | --- |
| StockLedger | id、variantId、delta（正负）、beforeQty、afterQty、reason（reserve / commit / release / restock / refund_return / scrap / adjust）、refType、refId、operator、createdAt | variantId + createdAt；**只追加，禁止 UPDATE / DELETE**；冲正靠反向流水；afterQty 必须等于上一条的 afterQty + 本条 delta |
| CheckoutSession | id、cartJson、priceSnapshot（JSON：variantId → price）、subtotal、lockedUntil（30 分钟）、email、createdAt | id 由前端带回；lockedUntil 过期后支付必须先重新校验价格 |

#### 生命周期与归因（4 张 · v2.1 新增）

| 表 | 关键字段 | 索引 / 约束 |
| --- | --- | --- |
| AbandonedCart | id、email、cartJson（快照）、subtotal、itemCount、startedAt、lastSeenAt、stage（0 未发 / 1 已发提醒 / 2 已发激励 / 3 已发末次 / 9 已转化 / 8 已放弃）、recoveredOrderId、round（第几轮） | email + startedAt；stage + lastSeenAt 供定时任务扫描；**同一 email 30 天内 round ≤ 2** |
| MarketingConsent | id、email（唯一）、marketingOptIn、birthdayOptIn、source（checkout / account / footer）、ip、consentedAt、revokedAt | email 唯一；**退订后 marketingOptIn = false 且不得再写 true**（只能用户自己重新勾选） |
| EmailLog | id、email、templateKey、category（transactional / marketing）、refType（order / cart / review / user）、refId、status（queued / sent / failed / skipped）、skipReason、openedAt、sentAt | email + sentAt（频次校验）；**(refType, refId, templateKey) 唯一**——邀评与弃购靠它做幂等，同一订单同一模板只发一次 |
| ChannelCost | id、channel、month（YYYY-MM）、spend、note、updatedAt | channel + month 唯一；手填，用于 CAC / ROI |

#### 评价与运营（9 张）

| 表 | 关键字段 | 索引 / 约束 |
| --- | --- | --- |
| Review | id、productId、orderId、email、rating（1–5）、title、body、imagesJson、height、scene、status（pending / published / rejected）、pinned、featured、**incentiveGranted**、**laterReturned**、monthsOwned、createdAt、publishedAt | productId + status；orderId + productId 唯一（一单一商品一次）；rating |
| ReviewAudit | id、reviewId、action（approve / reject / delete）、reasonCode（违规 / 广告 / 无凭证 / 其他）、reasonText、operator、createdAt | reviewId + createdAt；删除必须 reasonCode 非空 |
| Customer | id、email（唯一）、name、ordersCount、totalSpent、firstOrderAt、lastOrderAt、tier | email 唯一 |
| CustomRequest | id、email、productId、refImagesJson、text、qty、dueDate、status（new / quoted / converted / closed）、note、createdAt | status + createdAt |
| NotifyRequest | id、variantId、email、notified、createdAt | variantId + email 唯一（不重复收集） |
| EmailTemplate | key（唯一）、subject、bodyHtml、variablesJson、updatedAt | key 唯一 |
| JobRun | id、job（releaseReservation / promotionSwitch / restockNotify / birthstone）、startedAt、finishedAt、result、error | job + startedAt |

| 表 | 关键字段 | 索引 / 约束 |
| --- | --- | --- |
| Setting | 单行：brandName、currency（固定 USD）、freeShipThreshold、costs(JSON，含 returnRate 6% / colorGuaranteeRate 2%)、warehouses(JSON)、ownerEmail（仅作通知收件人，**不再是登录凭据**，v2.0 起后台登录走 User 表） | 固定 id=1 |

### 5.3 启动时的轻量迁移（v2.4 新增）

设计稿假设用 Prisma 做 schema 迁移；交付版是单文件 JSON，没有迁移工具，所以用一段**幂等的补齐函数**替代：

| 场景 | 做法 | 为什么不能省 |
| --- | --- | --- |
| 代码升级后新增了集合（如 `pages` 内容页覆写、`customRequests`、`sequences`） | 启动时 `store.normalize(db)` 检查这几个键，**缺失才补默认值，已有值一律不动** | 不补的话，升级代码后读 `db.pages.about` 会抛 `Cannot read properties of undefined`，整站 500 |
| 老数据文件没有新字段 | 只在内存里补，下一次写操作自然落盘 | 避免启动时就改写磁盘文件——万一补错了，原始数据还在 |
| 字段语义变更 | **不做自动转换** | 自动转换是最容易悄悄改坏数据的一步；语义变更必须写一次性脚本 + 备份，走人工确认 |

对应实现：`app/server/lib/store.js` 的 `normalize()`（约 8 行）。它有两条硬约束：

1. **只增不改**——`d.pages` 存在就整段跳过，不做深合并，避免把用户已编辑的标题覆盖回默认文案。
2. **不碰业务数据**——只处理结构与默认值，不迁移商品、订单、库存。

> 验证方式（手工，约 1 分钟）：拿一份缺 `pages` 字段的老 `db.json` 启动服务，`GET /api/v1/bootstrap` 应返回 12 个内容页、`/admin/content` 能正常打开。这条**没有自动化用例**——它需要一份"升级前"的数据快照，而基线快照始终是升级后的形态，自动化测不出来，属已知未覆盖项（见测试用例 v1.2 第 5 节）。

### 5.4 六个关键设计决定

- **订单项存快照**：下单时把标题、价格、变体、成本写入 OrderItem，之后商品改价不影响历史订单与毛利核算。
- **费率也要快照**：Order.costSnapshot 存下单瞬间的关税税率、头程费率、仓配单价、支付费率、包装费、退货计提、颜色保证准备金。**没有这一层，改一次税率就会把所有历史订单的毛利一起改掉**——这是 v1.0 最严重的账务漏洞。
- **订单归 User，但归属靠邮箱**：订单表存 `email`，账户订单按邮箱匹配（BR-20）。**刻意不给 Order 加 userId 外键**——访客必须先能下单，用户是后注册的；若用外键，访客订单无处挂载，注册时还要回填。代价是改邮箱必须迁移订单，这一点在 7.5 里用同一事务保证。Customer 表退化为**统计视图**（按邮箱聚合），不再承担身份职责。
- **权限位与角色分离**：`role` 决定"能不能进后台"，`permissions` 决定"进去能做什么"。`staff` 默认无 `price.write` / `review.delete` / `customer.export` / `refund.approve` 四个权限位——这四项直接对应钱与口碑，误操作代价最高。**判断权限只看权限位，不看角色**，避免"加个新角色到处改 if"。
- **优惠计算是纯函数**：`calc(cart, promotions, coupon, giftRules, settings) → { adjustments, gifts, total }`，不读数据库、不写数据库，输入输出都是普通对象。同一份函数被结算页预览、订单创建、后台改单三处调用，保证三处金额永远一致。
- **库存三值分离**：`onHand`（物理在库）、`reserved`（占用中）、`available = onHand − reserved`（可售）。不做物理预扣，只写占用记录，超时释放由定时任务扫 expiresAt 完成——避免"下单不付钱把库存锁死"。

## 6 接口设计

> **阅读提示（v2.4）**：6.1 / 6.2 是**方案 A（Next.js + PostgreSQL）**的目标接口形态，保留作为技术栈迁移时的参照；
> **已经交付并在运行的是 6.4 的 `/api/v1/*`**，两者语义一一对应，路径不同。验收与联调一律以 6.4 和《API 接口文档 v1.1》为准。

### 6.1 前台接口

| 方法 | 路径 | 说明 | 鉴权 |
| --- | --- | --- | --- |
| GET | `/api/products?collection=&metal=&sort=&page=` | 集合与筛选列表 | 公开 |
| GET | `/api/products/{handle}` | 商品详情（含变体、关联） | 公开 |
| GET | `/api/search?q=` | 搜索与联想 | 公开 |
| GET / POST / PATCH / DELETE | `/api/cart` | 读、加、改数量、删行 | 购物车 Cookie |
| POST | `/api/checkout/intent` | 创建支付意图，返回客户端密钥 | 购物车 Cookie |
| POST | `/api/webhooks/stripe` | 支付结果回调（签名校验） | Stripe 签名 |
| POST | `/api/orders/lookup` | 订单号 + 邮箱查单 | 公开 + 限流 |
| POST | `/api/cart/coupon` | 应用 / 移除优惠码，返回折扣明细或失败原因 | 购物车 Cookie + 限流 |
| GET | `/api/promotions/active?cart=` | 当前购物车可用的活动：自动折扣、赠品进度、免邮差额 | 公开 |
| POST | `/api/reviews` | 提交评价（订单号 + 邮箱校验后写入 pending） | 公开 + 限流 + 一单一商品一次 |
| POST | `/api/notify` | 到货提醒登记 | 公开 + 限流 |
| POST | `/api/custom` | 定制需求提交（含图片上传） | 公开 + 限流 |
| POST | `/api/newsletter` | 订阅 | 公开 + 限流 |

### 6.2 后台接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/admin/login` | 登录，成功写 HttpOnly 会话 Cookie |
| GET | `/api/admin/summary?days=30` | 概览指标与图表数据 |
| GET / PATCH | `/api/admin/orders`、`/api/admin/orders/{id}` | 列表筛选、详情、改状态 |
| GET / POST / PATCH | `/api/admin/products` | 商品增改、上下架 |
| GET / PATCH | `/api/admin/inventory` | 库存查询与批量调整 |
| GET / PATCH | `/api/admin/collections` | 集合与导航排序 |
| GET | `/api/admin/customers` | 客户列表与分层 |
| GET / PATCH | `/api/admin/content` | 首页区块与内容页 |
| GET / PATCH | `/api/admin/settings` | 品牌、费率、仓库、密码 |
| GET / POST / PATCH / DELETE | `/api/admin/marketing/coupons` | 优惠券增删改查、批量生成码、导出 |
| GET / POST / PATCH | `/api/admin/marketing/promotions` | 自动折扣活动、优先级、预算熔断 |
| GET / POST / PATCH | `/api/admin/marketing/gifts` | 满额赠品规则 |
| GET / PATCH | `/api/admin/reviews`、`/api/admin/reviews/{id}` | 审核队列、通过 / 拒绝 / 删除（需 reasonCode）/ 置顶 |
| GET / PATCH | `/api/admin/custom` | 定制需求单列表与状态流转 |
| GET / POST | `/api/admin/notify` | 到货提醒名单、批量发送补货通知 |
| GET | `/api/admin/jobs` | 定时任务最近执行结果，可手动重跑 |

### 6.3 约定

- 统一响应体：`{ ok, data, error }`；错误带 `code` 与可读 `message`。
- 金额一律用**整数分**存储与传输，避免浮点误差。
- 后台接口全部要求会话；写操作校验 CSRF Token；列表接口强制分页（默认 20，上限 100）。
- 幂等：`/api/checkout/intent` 与 webhook 以 `idempotencyKey` / 事件 id 去重，防止重复建单。

### 6.4 已交付接口与设计稿的对照（v2.4 新增，v2.5 更新规模）

交付版（`app/server`，Node 原生 + 单文件 JSON）按 6.1 / 6.2 的**语义**实现，路径统一加 `/api/v1` 前缀、后台统一走 `Authorization: Bearer`。规模：**48 个路径 / 56 个操作**（含 1 个公开静态图片路由），逐条说明见《API 接口文档 v1.2》，机器可读版见 `handover/04-接口文档/openapi.json`（OpenAPI 3.0.3，80 个模型）。

| 设计稿（6.1 / 6.2） | 已交付（`/api/v1`） | 语义差异 |
| --- | --- | --- |
| `GET /api/products`、`/api/products/{handle}`、`/api/search` | `GET /products`、`/products/{handle}`、`/products/search`、`/search` | 集合单独成接口：`GET /collections`、`/collections/{handle}` |
| 无（设计稿靠 SSR 直出） | `GET /bootstrap` | **新增**：一次返回导航、集合、设置、公告、12 个内容页文案，避免首屏 N 个请求 |
| `GET /api/cart`、`POST /api/cart/coupon` | 购物车在**前端 localStorage**，服务端只保留 `POST /cart/validate`、`POST /coupons/validate` | 访客模式下没有服务端会话，购物车不入库；校验仍由服务端算 |
| `POST /api/checkout/intent` | `POST /checkout/quote` → `POST /orders` | 拆成"报价锁 + 下单"两步（SDD 16.2），比一次性建支付意图更适合无 Stripe 的场景 |
| `POST /api/orders/lookup` | `POST /orders/lookup`、`GET /orders/{number}`、`POST /orders/{number}/cancel` | 取消走独立出口，与退款分开（16.4） |
| `POST /api/webhooks/stripe` | **未实现** | 支付未接入，见第 12 节风险表 |
| `POST /api/reviews`、`/api/notify`、`/api/newsletter` | **未实现** | 评价由后台录入（`GET/PATCH /admin/reviews`）；到货提醒与订阅在 v1.1 之后 |
| `POST /api/custom` | `POST /custom-requests`、`GET/PATCH /admin/custom-requests` | 定制单独立成前后台一对接口，状态机 `new → quoted → ordered → closed` |
| `POST /api/admin/login`（Cookie） | `POST /admin/login` → 返回 Bearer 令牌（12h） | 前后端同源部署也走令牌，便于以后分域 |
| `GET/PATCH /api/admin/{orders,products,inventory,customers,settings}` | 同路径 + `/admin/metrics`、`/admin/stock-ledger`、`/admin/audit-log`、`/admin/me` | 看板、流水、审计拆成独立读接口 |
| `GET/PATCH /api/admin/collections`、`/content` | `GET/POST/PATCH/DELETE /admin/collections`、`GET/PATCH /admin/content` | **已实现**（A-06 / A-08），集合删除前校验是否仍有商品挂着 |
| `GET/PATCH /api/admin/marketing/{coupons,promotions,gifts}` | `GET/POST/DELETE /admin/coupons` | 只做了优惠券；自动折扣与满额赠品规则以 `settings` + `giftRule` 承载，独立活动实体未做 |
| `GET/PATCH /api/admin/reviews/{id}` | 同路径 | — |
| `GET /api/admin/jobs` | **未实现** | 当前无定时任务（无库存占用释放、无活动切换） |
| 无（设计稿未含商品录入） | `POST /admin/products`、`GET/PATCH/DELETE /admin/products/{id}`、`POST /admin/products/{id}/duplicate`、`POST /admin/products/import/preview`、`POST /admin/products/import`、`GET /admin/products/import/template` | **v2.5 新增**：新建默认草稿、`handle` 与 `SKU` 自动生成、CSV 两段式导入（预检不写库）。删除时若有订单引用则返回 409，只能下架 |
| 无（设计稿靠对象存储） | `POST /admin/uploads` → `GET /uploads/{file}` | **v2.5 新增**：base64 JSON 上传，文件头魔数嗅探（不认扩展名，拒 SVG），落盘到数据卷 `uploads/`；读取走独立静态路由，不交 SPA 兜底（见 8.2） |

> **这张表怎么用**：接手的人常问"文档写 38 个接口，代码里怎么有 56 个"——因为设计稿按 Next.js 的路由习惯写，实现按"一次请求拿够数据"重组了，加上商品录入与图片上传是设计稿里没有、后来按运营需要补的（见《商品管理补全说明 v1.1》）。**以 6.4 为准做联调，以 6.1/6.2 为迁移目标。**

## 7 关键流程

### 7.1 下单与扣库存

- **1 校验**：校验地址 · **校验可售数 = onHand − reserved** · 命中活动列表
- **2 计价**：**自动折扣** · **优惠券** · **免邮判定** · **赠品门槛判定** · 计算运费与税
- **3 落单**：**写 StockReservation(held, 30min)** · 创建 pending 订单 · **写 costSnapshot** · **写 OrderAdjustment**
- **4 支付**：创建 PaymentIntent · 用户在 Stripe 内嵌表单支付
- **5 回调**：**校验签名 + 事件去重** · 订单转 paid · **占用转 committed 并实扣** · **券核销 +1**
- **6 通知**：发确认邮件 · 写入 StatusLog · 后台出现待配货

失败路径：支付失败 → 订单保持 pending → 30 分钟定时任务释放占用并关闭订单；回调重复 → 按事件 id 丢弃，不重复扣库存、不重复核销优惠券。

### 7.2 优惠计算顺序（promotion 模块）

- **① 自动折扣**：按 priority 取首个命中的 Promotion · 逐行计算 lineDiscount · 同一商品不重复打折
- **② 优惠券**：**校验 stackable** · 校验 minSubtotal（用折后小计） · 校验次数与预算 · 计算券减额
- **③ 免邮判定**：用②之后的金额判门槛 · **门槛用商品小计，不含运费税**
- **④ 赠品判定**：用②之后的商品小计判门槛 · **赠品库存足够才加车** · **写 $0 行 + 成本快照**
- **⑤ 兜底**：**应付 < $0.5 则拒绝该券** · **应付 < 成本线则警告并拒绝**

这五步必须**严格按序执行且只有一份实现**。v1.0 文档里三个活动各自独立描述、没有规定顺序，直接后果是"折扣算在券前还是券后"两处不一致，金额差 $3–$8，客诉无法解释。顺序一变，金额就变，所以顺序要写进代码常量而不是散在注释里。

### 7.3 评价审核流程

- **1 提交**：订单号 + 邮箱校验 · **校验该订单已 completed** · 写入 pending
- **2 待审**：后台红点提示 · 前台不展示、不计分 · 用户看到"审核中"
- **3 审核**：**通过 → published** · **拒绝 → rejected + 原因** · **删除 → 软删 + 必填原因**
- **4 聚合**：重算商品评分与评价数 · 失效商品页缓存 · 更新结构化数据

删除采用**软删**（保留记录与审核日志），不做物理删除：一是 GDPR 下的用户可主张删除权，需要可响应；二是一旦物理删除，就再也无法证明"我们没有因为分数难看而删评价"。

### 7.4 发货与退款

- 后台填运单 → 订单转 fulfilled → 发发货邮件（含物流号）→ 客户可用订单号查单。
- 退款：后台登记售后单 → 二次确认 → 调 Stripe 退款 → 订单转 refunded → 发退款邮件 → **显式选择入库决策**（restock / scrap / return_to_supplier，见 FR-A-065，不允许留空）→ 选 restock 才回补 onHand 并写 StockLedger。
- 退款的连带回退（v2.2 补，原先完全缺失）：**全额退款**时在同一事务里 ① 优惠券使用次数回退 + CouponRedemption 置 revoked；② 活动 spent 回退；③ 赠品 usedCount 回退；④ 退款金额计入 netRevenue。**部分退款不回退优惠**（优惠已实际享用），只计入净营收。见 BR-23。
- 退款后的评价：Review.laterReturned = true，前台标注 "Verified purchase · Later returned"，**不删除、仍计入评分**（BR-24）。
- 换新（终身颜色保证）：登记 exchange 售后单 → 不退款 → 生成一条 **orderType = exchange** 的 $0 换新单 → 扣减一件库存（写 StockLedger，reason = restock 的负向 commit）→ 成本从颜色保证准备金归集。旧件不要求退回。**该单不计入订单数与 AOV**（FR-A-062）。

### 7.5 账户与订单归属（v2.0 新增）

这条流程看着简单，但四个环节任一处理错，用户就会看到"我的订单不见了"。原型里已经把四条都实现，这里给出服务端口径。

#### 注册与访客订单继承

```
POST /api/auth/register { name, email, password }
  1. email 归一化小写 → 查 User 唯一性，冲突返 409
  2. passwordHash = argon2id(password)
  3. 事务：INSERT User
          + 把 Order.email = 该邮箱的访客订单自动归入账户（无需回填字段，靠匹配即生效）
  4. 建 Session（HttpOnly Cookie）→ 写 lastLoginAt
  5. 发欢迎邮件（EmailTemplate key = welcome）
```

#### 登录

```
POST /api/auth/login { email, password }
  失败一律返回「邮箱或密码不正确」，不区分账号是否存在（防枚举）
  计数键 = email + ip，5 次失败锁定 10 分钟
  成功 → 建 Session；若带 ?next= 且在白名单（/checkout、/cart）则跳回
```

#### 改邮箱（最容易出事的环节）

```
PATCH /api/account/email { newEmail, currentPassword }
  1. 校验 currentPassword —— 改邮箱属于敏感操作，必须验密码
  2. 校验 newEmail 未被占用（含大小写归一后）
  3. 单事务内：
       UPDATE User    SET email = newEmail WHERE id = ?
       UPDATE "Order" SET email = newEmail WHERE lower(email) = lower(oldEmail)
  4. 若两步分属不同事务，中间失败 = 用户历史订单全部"消失"
  5. 发安全通知邮件到旧邮箱（异常改绑的第一时间告知）
```

#### 注销

```
DELETE /api/account  { password }
  1. 二次确认 + 验密码
  2. User.status = 'deleted_marked'，Session 全部 revoke，PII（姓名 / 电话 / 地址）清空
  3. 订单不删：Order.email 保留（财务与税务凭证需留存 7 年），仅解除账户关联
  3b. 停止全部营销自动化（v2.2 补）：
        MarketingConsent.marketingOptIn = false, birthdayOptIn = false
        AbandonedCart where email = ? → stage = 8（已放弃）
        EmailLog where status = 'queued' and category = 'marketing' → status = 'skipped'
        交易类邮件（在途订单）仍可发
  4. Address / WishlistItem 物理删除
  5. 记录删除请求时间与范围，供 GDPR / CCPA 审计
```

> **为什么订单不跟着删**：GDPR 的删除权与税务留存义务是冲突的，通行做法是**保留交易记录、清除可直接识别个人的字段**。所以注销后订单仍在库里（金额、商品、日期），但姓名、电话、详细地址被清空，只留邮箱作为交易凭证索引——这一点必须写进隐私政策，否则会被投诉"说好删除却还留着"。

### 7.6 弃购挽回流程（v2.1 新增）

```
触发：POST /api/cart/touch（每次购物车变更，节流 60s 写一次）
  条件：有 email + 有商品 + 未下单
  写 AbandonedCart(lastSeenAt = now)

定时任务（每 30 分钟）：
  for cart in AbandonedCart where stage in (0,1,2) and 未转化:
      elapsed = now - lastSeenAt
      if stage == 0 and elapsed >= 4h  → stage 1，发「提醒」模板
      if stage == 1 and elapsed >= 24h → stage 2，发「激励」模板
      if stage == 2 and elapsed >= 72h → stage 3，发「末次」模板
  每次发送前统一校验（缺一不发，全部在发信那一刻执行，不在扫描开始时）：
    ① MarketingConsent.marketingOptIn == true
    ② 24 小时内该 email 无 marketing 类 EmailLog
    ③ 该轮次未发过（EmailLog 唯一约束兜底）
    ④ 该 email 无已完成订单
    ⑤ 最近 2 小时无已支付订单（v2.2 补：否则用户刚付完款就收到"购物车还在等"）
    ⑥ 该 email 对应的 User 未处于 deleted_marked 状态

激励策略（FR-S-161）：
  新客 = 无已完成订单 → 赠品（默认）或免运（开关，默认关）
  老客 = 有已完成订单 → 赠品（永不给免运折扣）
  末次 = 10% 券，作用域仅限本购物车所含集合
```

> **为什么把免运做成开关而不是默认开**：免运直接减少收入，且会训练"等 24 小时"的行为。做成开关意味着它可以先关着上线，等 A/B 数据出来再决定——**把不可逆的决策变成可逆的配置**，这是这类增长功能正确的接入方式。

### 7.7 邀评与激励流程（v2.1 新增）

```
定时任务（每日）：
  扫 Order where status = 'completed' and completedAt = today - 10d
  为每个 OrderItem 生成邀评邮件（一单一次，不按商品拆封）
  发送前校验：MarketingConsent + 频次 + EmailLog 幂等
  链接 = /reviews/write?token=HMAC(orderId, email, exp=30d)

提交（无需登录）：
  1. 验签 token → 取 orderId
  2. 校验该 orderItem 未评价过（Review 唯一约束）
  3. 写入 Review(status = 'pending', monthsOwned, incentiveGranted = false)
  4. 若含图 → 发券，不判断星级（BR-21）
     发券后 Review.incentiveGranted = true
  5. 前台展示时若 incentiveGranted → 标注 "Received a thank-you credit"

代码层面的约束：
  禁止任何 if (rating >= 4) 才发激励的分支 —— 由 lint 规则与 code review 双重把守
```

### 7.8 渠道归因采集（v2.1 新增）

```
落地页（首次进入）：
  解析 utm_source / utm_medium / utm_campaign / utm_content
  若 Cookie 同意为「分析类已同意」→ 写 first_touch cookie（90 天）
  未同意 → 不写任何 cookie，仅本次会话内存可用，关闭即失

每次进入：
  有新的 utm → 覆盖 last_touch cookie（30 天）

下单（Order 创建）：
  channel.first = first_touch.source  ?? 'direct'
  channel.last  = last_touch.source   ?? 'direct'
  固化写入 Order（不随后续 cookie 变化）

报表（FR-A-052）：
  GMV(channel) = Σ Order.total where channel.last = channel
  CAC(channel) = ChannelCost.spend(month) / 新客数(channel.last, 首单)
  ROI = (GMV × 毛利率 − spend) / spend
  未归因部分单列 direct / unattributed，不做摊派
```

> **依赖关系要写死在这里**：FR-S-095 的 Cookie 同意条不是"体验优化"，而是**归因功能的前置条件**。同意条没上线，7.8 的采集就是违规采集 GDPR 意义上的个人数据。因此实施顺序必须是：同意条 → 归因采集 → 归因报表，不能倒序。

### 7.9 价格锁定与支付对账（v2.2 新增）

#### 结算价格锁定（BR-25）

```
进入结算页：POST /api/checkout/session
  → 返回 { sessionId, priceSnapshot, lockedUntil: now + 30min }
  → 前端随每次请求带回 sessionId

发起支付：POST /api/checkout/pay { sessionId, ... }
  1. 读 CheckoutSession，取 priceSnapshot
  2. 与当前商品价逐项比对
     • 完全一致 → 正常创建支付意图
     • 有差异   → 返回 409 + diff 明细，前端展示"价格已更新，请确认后继续"
                  禁止静默按新价扣款
     • 商品下架 / 售罄 → 返回 422，移出结算并说明
  3. 支付意图金额必须等于用户最终确认的金额
```

> **为什么不能静默改价**：用户看到 $58 却扣了 $62，在美国属于"未经授权的收费"，可以发起 chargeback。一笔 chargeback 的处理成本在 $15–$25，且会拉低支付通道的风险评级。**提示一次只损失一次转化，静默改价损失的是通道评级。**

#### 支付对账（FR-A-069）

```
每日 02:00，拉取前一日支付平台流水（Stripe Balance Transactions）
逐笔比对三组数据：
  平台流水 ←→ PaymentRecord ←→ Order

输出三类差异：
  ① 本地有、平台无  → 可能支付未真正成功（需查 intent 状态）
  ② 平台有、本地无  → 可能回调丢失（需按 intentId 补单）
  ③ 金额不一致      → 退款 / 部分退款 / 币种问题

每条差异必须人工标记结果：confirmed（确认无误）/ fixed（已补单）/ ignored（说明原因）
连续 7 天差异为 0 视为通过；任一天有未处理差异，后台概览顶部常驻提醒
```

### 7.10 库存流水（BR-26）

```
所有库存变动只允许一个入口：
  StockService.apply(variantId, delta, reason, refType, refId, operator)

  reason 取值（穷举，不接受自由文本）：
    reserve        下单占用（写 StockReservation）
    commit         支付成功，占用转实扣
    release        超时 / 取消，释放占用
    restock        退货重新入库（需 AfterSale.restockDecision = restock）
    refund_return  退款回补
    scrap          报废（瑕疵品）
    adjust         盘点调整（必须填说明）

  禁止：UPDATE Variant SET onHand = ...（任何绕过 StockService 的写法在 code review 阶段拒绝）
```

## 8 部署与运维

| 项 | 方案 | 说明 |
| --- | --- | --- |
| 服务器 | 2C4G 云主机起步 | 预估日订单 < 200 完全够用 |
| 容器 | Docker + Coolify | 一键部署、回滚到上一版本 |
| 反向代理 | Nginx | HTTPS 终止、gzip/brotli、静态资源长缓存 |
| 域名与证书 | 自有域名 + Let's Encrypt 自动续期 | 强制 HTTPS，HTTP 301 |
| 数据库 | 同机 PostgreSQL 起步，后续迁托管 | **每日全量备份 + 保留 30 天**，备份需实测可恢复 |
| 环境 | production / staging 两套 | staging 用于验收，不接真实支付 |
| 日志 | 应用日志 + 访问日志 + 支付失败告警 | 保留 14 天 |
| 回滚 | 镜像版本回退 + 数据库迁移分离 | 迁移只做向前兼容，不回滚数据 |

### 8.1 当前交付版的部署形态（v2.4 新增）

上表是**目标形态**（方案 A：Docker + Coolify + PostgreSQL）。已经交付并正在运行的版本更轻，部署时必须按下面这套来：

| 项 | 交付版实际 | 与目标形态的差距 |
| --- | --- | --- |
| 运行时 | 宿主机 Node ≥ 18，**零第三方依赖**，没有 `npm install` | 无容器也能跑；容器只是可选封装 |
| 进程管理 | systemd 单实例（`tideglass-api.service`） | 未用 Coolify |
| 存储 | `app/server/data/db.json` 单文件 + 内存镜像 + 原子写；同目录 `uploads/` 存商品实拍图 | 未接 PostgreSQL；图片未上对象存储 |
| 数据备份 | `deploy/backup.sh` / `backup-docker.sh` 定时快照 + 恢复前 JSON 校验；**v2.5 起连 `uploads/` 一起打包** | 无每日全量 + 30 天保留的自动化，需自己挂 cron（手册第 10 章给了 cron 行） |
| 反向代理 | 宿主机 Nginx，静态文件由 Nginx 直出，仅 `/api/` 反代 | 一致 |
| HTTPS | certbot / Let's Encrypt | 一致 |
| 无域名场景 | Nginx 独立端口（默认 8080），不占 80/443 | 目标形态没考虑这一档 |

### 8.2 文件存储（v2.5 新增）

商品图不走对象存储，直接落在数据卷里，与 `db.json` 同目录：

```
/app/app/server/data/
├── db.json          # 全部业务数据
└── uploads/         # 后台传上来的商品图
    └── p-mwfvtoax-4f335c.jpg
```

| 决策 | 做法 | 理由 |
| --- | --- | --- |
| 存哪 | 数据卷 `tideglass-data`，容器重建不丢 | 与 `db.json` 同一份持久化边界，备份/迁移只有一个源 |
| 命名 | `p-<时间戳 base36>-<随机6位>.<ext>` | 不用原始文件名：中文/空格/重复名都要额外处理，随机名一次解决，且无法被枚举 |
| 类型判断 | **只读文件头**（JPEG `FF D8 FF`、PNG `89 50 4E 47`、WebP `RIFF….WEBP`） | 扩展名可改、`Content-Type` 可伪造；**SVG 明确拒绝**——它能藏脚本，直接访问链接即 XSS |
| 体积 | 单张 ≤ 5 MB，前端压到最长边 1600 px、q0.82（实际 200–400 KB） | 饰品图 1600 px 足够 2 倍屏；不压缩的话手机原图 5 MB 一张，前台首屏会拖死 |
| 路径防护 | 文件名白名单 `[A-Za-z0-9._-]` + `path.resolve` 后必须仍在 uploads 目录内 | 挡 `/uploads/../../db.json` |
| 孤儿清理 | 每小时扫一次，删除「没被任何商品 `images` 引用且 mtime > 24h」的文件 | 用户中途放弃编辑、换图、删商品都会留下孤儿；立即删会误删正在编辑中的图 |
| 读取 | 独立路由 `GET /uploads/:file` | **不能交给 SPA 静态兜底**：兜底对未命中路径回 `index.html`，图片 404 时浏览器收到 HTML，表现为裂图 + MIME 报错 |
| 备份 | `backup-docker.sh` 用 `tar -czf -` 从容器里打包 `uploads/`，与 `db.json` 同一批次、同一保留策略 | 只回滚数据不恢复图片，商品会全部变裂图 |

**迁移注意**：换服务器时，`uploads/` 必须与 `db.json` 一起搬。只搬 `db.json` 的话，商品记录都在、图全丢，前台一片裂图——而且这种"数据看起来是好的"的坏法比直接丢数据更难排查。

**单实例是硬约束，不是建议**：数据镜像、限流令牌桶、会话表三处状态只活在进程内存里。起第二个进程 → 两个内存镜像互相覆盖 → 静默丢单。所以：

- 不要 `pm2 -i max` / `cluster` / `--scale` / 多副本；
- 不要在前面挂负载均衡到两台机器；
- 需要横向扩容时，先按 5.3 / §11 把存储换成 PostgreSQL，再谈多实例。

完整操作步骤（含无域名模式、与已有项目共存、备份演练、13 类故障排查）见《服务器部署手册 v1.1》。

## 9 安全与合规

| 面 | 措施 |
| --- | --- |
| 账户鉴权（v2.0 扩充） | 前后台**同一套 User 表**：argon2id 密码哈希（**永不存明文、不可逆**）、HttpOnly + SameSite=Lax + Secure Cookie、会话 24h、登录失败按 email + ip 限流并锁定、Session 只存 tokenHash、改邮箱与改密码均需验旧密码并通知旧邮箱 |
| 后台授权 | 进后台校验 `role ∈ {staff, owner}`，`customer` 一律 403；敏感操作按权限位二次校验：`price.write`（改价）、`review.delete`（删评价）、`customer.export`（导出客户）、`refund.approve`（退款审批）；越权尝试写安全日志 |
| 登录枚举防护 | 注册与登录对"邮箱已存在 / 不存在"给出统一文案，避免被批量探测账号；忘记密码同样只回"如果该邮箱已注册，我们已发送邮件" |
| 输入 | 服务端全量校验；富文本白名单过滤；上传限类型与大小 |
| CSRF / XSS | 写操作校验 Token；输出转义；CSP 限制外链脚本 |
| 支付 | Stripe 托管卡信息，服务端只存支付意图 id 与结果，不落卡号（PCI 责任转移） |
| 隐私 | 只收集履约必需信息；隐私政策与删除通道；Cookie 同意后才加载分析 |
| 合规 | GDPR / CCPA（同意、访问、删除）；IOSS 与关税展示（待确认具体国家） |
| 数据 | 全链路 HTTPS；备份加密；敏感配置走环境变量不入库不入 Git |
| 审计 | 后台关键动作写操作日志（改价、改库存、退款、**删除评价**、**改活动**） |
| 评价治理 | 删除为软删 + 原因必填 + 审核日志独立表；低分删除次数月度统计并在概览提示，防止把评分"修"漂亮 |
| 资金对账（v2.2） | 每日自动比对支付平台流水与本地订单，三类差异（本地有平台无 / 平台有本地无 / 金额不一致）必须逐条人工标记；未处理差异在后台常驻提醒。**不做"总金额相等即视为平"的粗略对账**——金额相等但笔数不同的情况真实存在（一笔合并支付、一笔拆单） |
| 价格与授权一致性（v2.2） | 支付金额必须等于用户最终确认的金额（BR-25）；价格变动只能通过"提示确认"处理，禁止静默改价；批量改价需预检冲突并留撤销窗口（FR-A-066） |
| 库存审计（v2.2） | 库存只允许通过流水变动（BR-26），流水不可修改删除；任一 SKU 当前库存必须等于流水累计，可作为盘点依据 |
| 营销邮件同意（v2.1） | 严格区分交易类与营销类：交易类（订单 / 发货 / 退款 / 密码重置）无需同意，营销类（弃购 / 邀评 / 活动 / 生日 / 补货）必须有 opt-in 且每封含退订；**退订即时生效**；服务层强制同一用户 24 小时内最多 1 封营销信（BR-22 / FR-A-061）；"下单时填了邮箱"不得视作营销同意 |
| 评价激励合规（v2.1） | 激励不得以正面评价为条件（带图即赠，不论星级）；展示处必须标注激励来源（FTC 要求）；**禁止引导修改或删除低分评价**；图片营销使用需单独授权，未授权图片不得用于首页 / 社媒 / 广告（BR-21） |
| 归因与 Cookie（v2.1） | 分析类 Cookie 必须先取得同意才写入；未同意时只允许会话内存态，不落持久 cookie；归因报表只使用已同意用户的数据，**并在报表页注明覆盖率**（避免用违规数据算出的 ROI 误导投放决策） |
| 个人信息用途限制（v2.1） | 生日字段可选填、仅用于用户单独同意的生日提醒；不用于画像或第三方共享；账户注销时营销同意与生日字段一并清除 |
| 营销防刷 | 优惠券按邮箱 + 设备指纹双限；批量码带渠道标签；预算熔断；同一 IP 短时高频失败请求限流 |
| 上传 | 定制参考图与评价晒图：限 jpg/png/webp、单张 ≤5MB、重编码去 EXIF、存对象存储私有读，不落本地磁盘 |

## 10 性能与缓存

- **页面**：商品页与集合页 SSR 后做短时缓存（60s）+ 内容变更时主动失效。
- **图片**：统一 4:5，输出 3 档宽度（480 / 900 / 1400），WebP 优先，懒加载首屏以下。
- **数据库**：列表查询走索引；后台统计用按日聚合表，避免每次全表扫描。
- **活动缓存**：当前生效活动列表缓存 60 秒，活动起止由定时任务主动失效——不能缓存到活动结束后，否则用户会看到过期价格。
- **评分缓存**：商品评分与评价数缓存 5 分钟，审核通过/删除时立即失效对应商品缓存。
- **结算**：优惠计算不查库，活动与券数据由上层一次性取出后传入纯函数，单次计算 < 5ms。
- **前端**：首页 JS 体积控制在 100KB 以内；图表用轻量 SVG 自绘，不引大库。
- **指标**：LCP ≤ 2.5s、CLS ≤ 0.1、TTFB ≤ 500ms（目标值，验收时实测）。

## 11 演进路线

| 阶段 | 内容 | 触发条件 |
| --- | --- | --- |
| v1（首版） | 访客下单、**营销中心（券/补贴/赠品）**、**自建评价与审核**、定制单、到货提醒、**13 个后台模块**、Stripe + 邮件 | 当前 |
| v1.1 | 数据导出增强、邮件模板编辑、活动效果看板、定时任务可视化 | 首版上线后 1 个月 |
| v2 | 账户体系与收藏、多语言（英/法）、客户分层营销、订阅制 | 月订单 > 500 或进入加拿大法语区 |
| v3 | 多仓发货、自动选物流、退货自助、集合三轴（若导航改版） | SKU > 300 或订单 > 50/天 |

注意：v1.0 把"折扣码、定制需求单"放在上线后的 v1.1，与"促销必备"的判断自相矛盾。v1.1 文档起，营销与评价列入首版，因为它们直接决定客单价与信任度，不是可延后的增强项。

## 12 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 支付回调丢失 | 已付款但订单未转 paid | 定时对账任务，按 Stripe 会话反查并补单 |
| 超卖 | 客户付款后无货 | 支付成功时事务内扣减，扣失败自动退款并告警 |
| 优惠叠加算错 | 少收钱或多收钱，客诉无法解释 | 单一纯函数实现 + 边界用例单元测试（0.5 元下限、券过期、赠品缺货、活动切换瞬间） |
| 优惠券被羊毛党刷 | 预算被耗尽、真实客户拿不到 | perUserLimit 按邮箱 + 设备指纹双限；批量码带渠道标记；预算熔断 |
| 终身颜色保证被滥用 | 换新成本超准备金 | 一单一款终身一次；照片判定；批次留样追溯；月度监控换新率，超 8% 立即复盘供应链 |
| 评价删除被质疑 | 公信力受损、平台投诉 | 软删 + 原因必填 + 月度统计；低分删除次数超阈值在概览告警 |
| 图片体积过大 | 首屏慢、转化下降 | 上传即转码，限制源图尺寸 |
| 单机故障 | 全站不可用 | 每日备份 + 镜像化部署，30 分钟内可重建 |
| 合规披露不全 | 被投诉 / 支付通道风控 | 上线前逐项核对政策页与 Cookie 同意 |

## 13 待确认

| # | 决策点 | 我的建议 |
| --- | --- | --- |
| D1 | 选方案 A / B / C | A（自建全栈） |
| D2 | 数据库用 PostgreSQL 还是 MySQL | PostgreSQL（JSON 字段与事务更顺手） |
| D3 | 是否引入 Redis 缓存 | v1 不引，先用页面缓存；有性能问题再加 |
| D4 | 服务器放哪个区域 | 美国东部（客户主要在美东/加东） |
| D5 | 图片是否上 CDN | 上线即上，Cloudflare 起步 |
| D6 | 是否要 staging 环境 | 要，验收与培训都在 staging 做 |

## 14 需求追溯矩阵

评审时最容易挑出的问题是"这条需求到底落在哪个模块、哪张表、哪个接口"。下表把 FRD 的需求块逐段映射到实现位置，**每一行都能反查**。

| FRD 需求块 | 模块 | 主要表 | 接口 | 前端 |
| --- | --- | --- | --- | --- |
| FR-S-001~010 全局框架 | content | ContentBlock | —（SSR 直出） | layout 组件 |
| FR-S-020~031 首页 | content、promotion | ContentBlock、Promotion | `/api/promotions/active` | 首页 11 区块 |
| FR-S-040~049 集合与搜索 | catalog | Product、Variant、Collection | `/api/products`、`/api/search` | 集合页 + 商品卡 |
| FR-S-050~059 商品详情 | catalog、review | Product、Review | `/api/products/{handle}` | 详情页 |
| FR-S-070~079 交易链路 | cart、order、payment | Order、OrderItem、StockReservation | `/api/cart`、`/api/checkout/intent`、`/api/webhooks/stripe` | 抽屉 / 结算 |
| FR-S-140~153 账户中心（v2.0） | auth、account、order | User、Session、Address、WishlistItem、Order(email) | `/api/auth/*`、`/api/account/*`、`/api/orders/lookup` | S-13~S-20 |
| FR-S-160~170 生命周期（v2.1） | growth、mail、catalog、after-sale | AbandonedCart、EmailLog、MarketingConsent、Review | `/api/cart/touch`、`/api/reviews/write`、`/api/account/after-sale` | 邮件 / S-21~S-24 |
| FR-S-090~098 内容与辅助 | content、custom | ContentPage、CustomRequest | `/api/custom` | 内容页 / 定制 / 评价提交 |
| FR-S-110~119 营销呈现 | promotion | Coupon、CouponRedemption、Promotion、GiftRule、OrderAdjustment | `/api/cart/coupon`、`/api/promotions/active` | 赠品进度条 / 券输入 / 角标 |
| FR-S-130~135 评价 | review | Review、ReviewAudit | `/api/reviews` | 评价区 / 提交页 |
| FR-A-001~019 交易与商品 | auth、order、catalog、inventory | Order、Variant、Setting | `/api/admin/*` | 13 个后台模块 |
| FR-A-019 / A-06 / A-08 集合·内容·定制单（v2.4 已实现） | catalog、content、custom | Collection、ContentPage、CustomRequest | `/api/v1/admin/collections`、`/admin/content`、`/custom-requests` | A-06 / A-08 / A-12 |
| FR-A-020~030 营销中心 | promotion | Coupon、Promotion、GiftRule、OrderAdjustment | `/api/admin/marketing/*` | A-10 |
| FR-A-040~048 评价与名单 | review、notify、mail | Review、ReviewAudit、NotifyRequest、EmailTemplate、JobRun | `/api/admin/reviews`、`/api/admin/notify`、`/api/admin/jobs` | A-11 / A-12 |
| FR-A-050~061 运营效率（v2.1） | analytics、catalog、inventory、mail | ChannelCost、EmailLog、Variant、Customer | `/api/admin/analytics/*`、`/api/admin/bulk/*` | A-14~A-20 |
| BR-01~22 业务规则 | order、promotion、inventory | Setting、Order.costSnapshot | —（服务层强校验） | — |
| 状态机 + 售后类型 | order | Order、StatusLog、AfterSale | `/api/admin/orders/{id}` | 订单详情 |

## 15 邮件模板 / 埋点 / 定时任务

### 15.1 邮件模板（6 个）

| key | 触发时机 | 必含变量 | 目的 |
| --- | --- | --- | --- |
| order_confirm | 支付成功 | orderNo、items、total、address | 确认 + 降低客服询问 |
| shipped | 填运单号 | orderNo、carrier、trackingNo、eta | 减少"我的货到哪了" |
| refund_done | 退款完成 | orderNo、amount、days | 告知到账周期 |
| review_invite | 签收后 7 天 | orderNo、productTitle、reviewUrl | 评价来源的主要入口（首版没这个，评价数会一直是 0） |
| restock | 补货上架 | productTitle、variant、buyUrl | 把等待需求转成订单 |
| color_guarantee | 换新受理 | orderNo、newShipmentNo | 兑现承诺的仪式感 |

### 15.2 关键埋点（8 个）

| 事件 | 参数 | 用来回答什么 |
| --- | --- | --- |
| view_collection | handle、position | 哪个入口带来的流量最多 |
| quick_add | productId、variantId、from（collection / home） | 卡片直接加购到底贡献多少（验证 FR-S-045 值不值） |
| add_to_cart | productId、variantId、price | 详情页加购率 |
| coupon_apply | code、result、amount | 券的真实使用与失败率 |
| gift_unlocked | ruleId、threshold、subtotal | 赠品门槛是否定对了 |
| checkout_start / purchase | value、items、coupon | 漏斗与 GMV 归因 |
| review_submit | productId、rating | 评价转化率与满意度分布 |
| color_guarantee_claim | orderNo、productId、reason | 承诺的真实成本，决定 2% 准备金够不够 |

### 15.3 定时任务（4 个）

| 任务 | 频率 | 做什么 | 失败后果 |
| --- | --- | --- | --- |
| releaseReservation | 每 5 分钟 | 扫 expiresAt 过期占用 → 释放 → 关闭对应 pending 订单 | 库存被锁死，商品显示售罄但实际有货 |
| promotionSwitch | 每 1 分钟 | 按起止时间切换活动状态、失效页面缓存 | 活动不开始或不结束，价格错误 |
| restockNotify | 每小时 | 检测库存从 0 变正 → 通知 NotifyRequest | 错过转化机会 |
| birthstone | 每月 1 日 00:00 ET | 切换当月在售诞生石集合与首页区块 | 首页还挂着上月款 |

四个任务都写入 JobRun 表，后台可在设置页看到最近执行结果并手动重跑。任务必须**幂等**：重复执行不产生副作用。

## 16 服务端实现契约（v2.3 新增）

第 6 节写的是「有哪些接口、参数长什么样」；本节写「接口内部必须守住什么」。这 8 条与具体技术栈无关——换成 Next.js + PostgreSQL 同样成立——所以放在设计文档而不是实现笔记里。**它们同时也是验收判据**：任何一条不成立，前端看起来再正常也算没做完。

### 16.1 定价只发生在服务端

| 规则 | 具体做法 | 不这么做会怎样 |
| --- | --- | --- |
| 前端价格一律丢弃 | 下单与报价都**只采信** `productId / metal / size / qty` 四个字段；前端传来的 `unitPrice / total / discount` 全部忽略 | 改一下浏览器里存的价格就能低价买走，这在任何电商站点都是第一周就会被发现的漏洞 |
| 金额用整数分或两位小数封顶 | 所有金额落库前统一 `round2`；分项相加后再四舍五入一次，不做链式舍入 | 逐项舍入会累积误差，对账差几分钱，永远查不清 |
| 数量上限硬编码 | 单次结算最多 **30 行**，每行最多 **10 件** | 否则一个请求可以锁死全部库存，或让价格计算进入长循环 |
| 赠品也走定价引擎 | 赠品由服务端判定是否达标、是否有货，作为 **0 元行**参与下单与扣库存 | 前端自己插一个 0 元行就能白拿（见 FRD 12.11 缺陷 1） |

### 16.2 报价锁（quote）

用户在结算页看到的金额与他最终提交的金额必须是同一个。做法是「先报价、后下单」，中间用一张短期凭证串起来。

| 环节 | 行为 |
| --- | --- |
| 报价 | `POST /checkout/quote` 返回完整金额构成与 `quoteId`，有效期 **15 分钟** |
| 下单 | 必须带 `quoteId`；服务端重算一次，与报价金额**逐项比对** |
| 不一致 | 返回 `PRICE_CHANGED`，附新金额；前端提示"价格已更新"并让用户确认，**不静默按新价成交** |
| 过期 | 返回 `QUOTE_EXPIRED`，前端重新报价 |
| 用后即焚 | 一张 quote 只能成交一次，防止同一报价重复下单 |

### 16.3 幂等下单

用户在弱网下连点、或浏览器重试，都可能把同一个请求发两次。`POST /orders` 要求带 `Idempotency-Key` 请求头（前端在进入结算页时生成一个 UUID）。

- 首次请求：正常建单，把「键 → 订单号」记下来。
- 重复请求：**不再建单**，直接返回原订单，响应体带 `replayed: true`。
- 键的留存期与报价一致（15 分钟），过期后可复用同一键值。

验收方式：连点下单按钮 5 次，订单列表只多 1 条（FRD 验收清单第 14 项）。

### 16.4 订单状态机

```
paid       → fulfilling | cancelled | refunded
fulfilling → fulfilled  | cancelled | refunded
fulfilled  → completed  | refunded
completed  → refunded
refunded / cancelled   → （终态，不可再转）
```

- 任何不在上表中的转换一律返回 `INVALID_TRANSITION`，**终态不可回退**。
- 退款**必须**走 `POST /admin/orders/:number/refund`，不允许通过改状态实现——因为退款还要回补库存、释放券、回退客户消费（FRD 12.11 缺陷 7）。
- 接口返回订单详情时附带 `allowedTransitions`，后台界面**只渲染这些按钮**，从源头避免非法操作。

### 16.5 权限位，而不是角色判断

角色只决定「默认授予哪些权限位」，鉴权时**只判权限位**。这样加一个角色不需要改任何接口，调整某人的权限也不需要改代码。

| 角色 | 权限位 | 典型用途 |
| --- | --- | --- |
| owner | 全部 10 项 | 店主本人 |
| ops | 除 `settings:write` 外的 9 项 | 日常运营，能改商品与订单，但改不了运费与门槛 |
| support | 只读 4 项（`metrics:read` `orders:read` `products:read` `customers:read`） | 客服查单，不能改任何数据 |

**权限位清单（与 `app/server/lib/auth.js` 的 `ALL_PERMISSIONS` 逐字一致）**：

| # | 权限位 | 管什么 |
| --- | --- | --- |
| 1 | `metrics:read` | 看板指标与趋势 |
| 2 | `orders:read` | 订单列表与详情、定制需求单读取 |
| 3 | `orders:write` | 改状态、填运单号、定制单流转 |
| 4 | `orders:refund` | 退款（**单独一位**，因为它是唯一能把钱退出去的动作） |
| 5 | `products:read` | 商品、集合、库存的读 |
| 6 | `products:write` | 商品与集合的增删改 |
| 7 | `inventory:write` | 补货、库存调整 |
| 8 | `customers:read` | 客户列表与消费统计 |
| 9 | `coupons:write` | 优惠券增删与门槛设置 |
| 10 | `settings:write` | 品牌、费率、运费门槛、内容页文案 |

> **v2.4 更正**：上一版这里写的是 `reviews:write` / `audit:read`，与实现不符（D-015 的同类问题）。
> 实际实现里：**评价审核复用 `products:write`、审计日志读取复用 `metrics:read`、内容页编辑复用 `settings:write`、集合管理与商品共用 `products:write`、定制需求单复用 `orders:read/write`**。
> 新增模块**不新开权限位**是有意的——权限位越多，配置越容易出错，而单人运营阶段"谁能改内容"和"谁能改设置"本来就是同一个人。

所有写操作同时写一条审计日志（谁、什么时候、对什么、改前改后）。

### 16.6 库存流水

库存**不存"结果"就完事**，每次变动必须留下一条不可变记录（FR-A-068）。流的字段固定为：SKU、变动量（正负）、原因、关联单据、**变动后余额**、时间。

| 原因 | 触发点 | 变动 |
| --- | --- | --- |
| `seed` | 开账 / 首次导入 | 初始量 |
| `sale` | 下单成功 | 负 |
| `refund` | 退款且选择回补 | 正 |
| `cancelled` | 未发货取消 | 正 |
| `restock` | 后台手动补货 | 正 |
| `purchase-order` | 采购入库 | 正 |

> **硬判据：**任意时刻，每个 SKU 的流水末条余额必须等于当前库存。这条不成立，说明有库存变动绕过了流水——不是"数据不准"，是"有代码没走正规入口"，必须当缺陷处理。

### 16.7 乐观锁：防止两个人同时改同一件商品

商品带一个自增 `version`。后台编辑时提交读到的 version；服务端比对，不一致则返回 `409` 并附当前值，让操作者重新确认。**不做"后写覆盖"**——两个人同时改价格，后保存的人必须知道前一个人改了什么。**改价同时校验不低于成本价**（`PRICE_BELOW_COST`），变体价按比例跟随主价。

### 16.8 限流与统一错误结构

| 路由组 | 阈值 | 为什么 |
| --- | --- | --- |
| 报价 / 校验 | 每 IP 每分钟 60 次 | 结算页会随输入频繁调用，放宽但要防刷 |
| 下单 | 每 IP 每分钟 20 次 | 正常用户不可能超过 |
| 查单 | 每 IP 每分钟 30 次 | 订单号可枚举，必须限 |
| 后台登录 | 每 IP 每 5 分钟 10 次 | 防撞库 |

所有错误响应结构一致，前端**按 code 分支**而不是按文案匹配：

```json
{ "error": { "code": "OUT_OF_STOCK",
             "message": "Only 2 left for Foxtrot Pendant / Gold.",
             "details": [{ "sku": "TG-101-GO", "requested": 3, "available": 2 }] } }
```

| code | HTTP | 前端该做什么 |
| --- | --- | --- |
| `OUT_OF_STOCK` | 409 | 标注具体行，提示可减量或改选 |
| `PRICE_CHANGED` | 409 | 展示新旧金额，请用户确认后重新提交 |
| `QUOTE_EXPIRED` | 409 | 静默重新报价 |
| `COUPON_INVALID` | 422 | 按 details.reason 分别提示（过期 / 未开始 / 未达门槛 / 已用完 / 已停用） |
| `INVALID_TRANSITION` | 409 | 刷新订单，按 allowedTransitions 重绘按钮 |
| `RATE_LIMITED` | 429 | 提示稍后再试，禁用按钮至重试窗口结束 |
| `UNAUTHORIZED` / `FORBIDDEN` | 401 / 403 | 401 清本地令牌回登录页；403 提示无权限并隐藏入口 |

> **这 8 条与第 12 节的一个区别。**第 12 节写的是"出错时怎么办"（降级、告警、兜底）；本节写的是**"正常情况下也不许绕过"**。前者是运维视角，后者是正确性视角。两者都缺一不可，但顺序不能反——先把账算对，再谈算挂了怎么办。
>
> 参考实现：当前 `app/server`（Node 原生 + 单文件 JSON）已按上述契约实现，接口自动化测试 **121 例**全通过（其中 22 例专测集合 / 内容 / 定制单三个新增模块），可作为技术栈迁移时的行为基线。接口清单与请求示例见《API 接口文档 v1.1》，路径对照见本文 6.4。

---

— 文档结束 · TG-SDD-001 v2.4 定稿 · 与 FRD v2.6 一并作为开发与验收依据 —
