# LASTGROVE API 接口文档

| 项 | 内容 |
| --- | --- |
| 文档编号 | LG-API-001（原 TG-API-001） |
| 版本 | v1.6 |
| 编写日期 | 2026-11-16 |
| 对应实现 | `app/server`（Node 原生，零第三方依赖） |
| 对应需求 | FRD v2.10、SDD v2.6 第 16~19 节、《商品管理补全-需求与设计说明 v1.1》、SDD §17 博客、《站点运营体检与功能增删改清单 v2.0》 |
| 端点数量 | **81 个操作，分布在 67 条路径**（v1.6 实测 `grep -c "router\.(get\|post\|patch\|put\|delete)"` 统计，与 v1.5 持平——本版只改既有端点的行为与字段，不新增端点） |
| 自动化覆盖 | 接口 147 例（`api-test.js`）+ 员工 53 例（`api-test-staff.js`）+ 博客 46 例（`api-test-blog.js`）；单元 38 + 11 例；浏览器 82 + 27 + 23 + 29 例。全绿（见《测试报告 v1.8》） |
| 机器可读版 | 同目录 `openapi.json`（OpenAPI 3.0.3，**v1.2 快照，尚未包含 v1.3 的支付与物流端点、v1.4 的税务与员工端点、v1.5 的博客端点、v1.6 的 socials 字段**） |

> **v1.6 变更**：**没有新增端点**。这一版改的是四个既有端点的行为，起因是运营侧《站点运营体检与功能增删改清单 v2.0》查出「后台能点的和前台发生的对不上」——其中四处落在接口层，界面改不动，只能改这里。
>
> 一、`PATCH /admin/settings` 新增 `socials` 字段（`instagram` / `pinterest` / `tiktok`），**只接受 `http(s)://` 开头的绝对地址**，空串表示「没有这个账号」。取值存空串而不删键 —— 删了键，后台表单下次就回填不出「上次填过什么」。
>
> 二、`PATCH /admin/settings` 成功时**一并 `meta.postsRev++`**。这原本是文章写操作的专属失效键，但 `/journal` 系列的页头页脚是服务端预渲染并缓存的，而公告条、社交图标、免邮门槛都来自 `settings` —— 只 ++ 文章的话，店主填完 Instagram，博客页仍是旧的那份，看起来像没保存。代价是文章页首次请求回源一次。
>
> 三、**四个导出端点全部写审计**：`GET /admin/export/orders.csv`、`tax.csv`、`products.csv`、`customers.csv` 现在各写一条 `export.<kind>` 审计（`target=csv`，`meta.count` 为导出条数；`tax.csv` 无行数概念，记 `null`）。导出一张客户表就是带走一份带邮箱的名单，是这个后台里唯一能一次性拿走全部客户资料的动作，而它此前一条日志都没有——GDPR 的可追溯性、CCPA 访问请求的处理都要求「谁在什么时候导了什么」。GET 也写日志，所以显式 `flush`，不 flush 就只剩内存副本、重启即丢。
>
> 四、`GET /admin/settings` 与前台 `GET /bootstrap`、`/journal` 页注入的 `shellData` 三处**都带出 `settings.socials`**，且缺省为 `{}`（不是 `undefined`）。前台据此决定页脚那排图标渲不渲染：没配就整块不出现，而不是渲染三个指向 `/#/pages/about` 的图标——点得开但不是它说的那件事，比没有更伤信任。
>
> **v1.5 变更**：补齐**博客**——`GET /posts`、`GET /posts/:slug`（公开 2 个），`GET /admin/posts`、`GET /admin/posts/:id`、`GET /admin/post-meta`、`POST /admin/posts`、`PATCH /admin/posts/:id`、`DELETE /admin/posts/:id`（后台 6 个）；新增权限位 `posts:write`（owner 与 ops 默认拥有，support 不含），见 §5.17。
>
> 这一版的接口本身不难，难的是它背后的一个判断：前台一直是 hash 路由，而 `#` 之后的部分在爬虫眼里不属于 URL——`origin + '/#/products/x'` 与 `origin + '/'` 是同一个地址。**sitemap 里塞 80 条 `#/` 开头的「URL」比只放 1 条更有害**，那是 80 条重复内容。所以这一版只给博客开真路径（`/journal`、`/journal/<slug>`），其余页面继续走 hash 路由：不给全站引入 `pushState` + `popstate` + 滚动恢复三件套，那三样是 SPA 路由 bug 的主要产地。sitemap 已同步瘦身为 `/`、`/journal`、每篇文章三行。
>
> 两条「拒绝说谎」的规则写在接口层：草稿对公开接口表现为**与不存在完全同形的 404**（区分开就等于承认这里有篇没写完的文章）；`blocks` 传了非空却一块都没活下来时返回 **400** 而不是静默存成空文章。
>
> **v1.4 变更**：补齐**美国销售税**与**按行部分退款**两件事 —— 退款详见 §5.7 的 `POST /admin/orders/:number/refund`。销售税方面 —— `POST /checkout/quote` 新增 `state` 入参与 `tax / taxRate / taxState` 三个出参；`POST /orders` 改为**按订单收货地址的州重算税**（与报价州不一致时抛 `PRICE_CHANGED`，不再"按报价那笔收钱、按新地址记账"）；新增 `GET /admin/tax/report`、`GET /admin/export/tax.csv`、`PATCH /admin/settings` 的 `tax` 字段（含州名归一化与百分数自动换算）；`GET /admin/export/orders.csv` 增加 `Tax` / `Tax state` 两列。新增 §5.15 销售税专节。
>
> 同一版补上**员工账号管理**：`GET /admin/staff`、`POST /admin/staff`、`PATCH /admin/staff/:id`、`DELETE /admin/staff/:id`，新增 `staff:read` / `staff:write` 两个权限位（只有 owner 默认拥有），见 §5.16。三条护栏写在接口层而不是只写在界面里：不能动自己、不能动最后一个 owner、非 owner 不能造 owner。**owner 角色恒为全权限**，不读库里那份可能漏位的数组 —— 否则每次新增权限位都会静默地把老 owner 锁在门外。
>
> **v1.3 变更**：补齐**支付通道**与**物流追踪**两层接口 —— 新增 `GET /payments/methods`、`POST /payments/capture`、`POST /payments/webhook/:provider`、`POST /webhooks/tracking`、`POST /admin/orders/:n/tracking/refresh`、`GET /admin/tracking/quota`、`GET /admin/tracking/health`，共 7 个操作；`POST /admin/orders/:n/tracking` 行为扩展（保存即订阅 17TRACK + 发发货信 + 承运商白名单）；新增 §5.14 Webhook 专节，把「原始字节验签 / 400 停止重投 / 幂等」三条硬规则写在接口层。同时补记当时的一处能力缺失：`POST /checkout/quote` 无税额字段——该缺口已在 v1.4 关闭。
>
> **v1.2 变更**：补齐商品管理闭环 —— 新建、单件详情、复制、删除、图片上传、CSV 批量导入（预检 / 导入 / 模板），新增 9 个操作（8 条后台路径 + 1 条公开静态路径）。`PATCH /admin/products/:id` 的字段面从 8 个扩到 16 个。同时把 `cost` 从「所有后台角色可见」收紧为「仅 owner 可见」。
>
> **v1.1 变更**：补齐后台三个模块的接口 —— 集合（4 个操作）、内容（2 个）、定制需求单（3 个，含 1 个前台匿名提交端点）。v1.0 漏掉这三个模块不是笔误：上一版后台只实现了 10 个模块，接口自然也只有那些。这一版把 FRD 第 48 行要求的模块补齐后，接口随之增加 9 个操作。

---

## 1 概览

### 1.1 基地址

```
http://localhost:4600/api/v1
```

前台页面与接口同源部署，前端不需要配 CORS。若前后端分离到不同域名，接口已开启 `Access-Control-Allow-Origin: *`，但生产环境应改为白名单。

### 1.2 通用约定

| 项 | 约定 |
| --- | --- |
| 协议 | HTTP/1.1。生产环境必须走 HTTPS |
| 方法 | 查询用 `GET`，创建用 `POST`，局部更新用 `PATCH`，删除用 `DELETE` |
| 请求体 | `application/json; charset=utf-8`，上限 **256 KB** |
| 响应体 | `application/json; charset=utf-8`，统一 UTF-8 |
| 金额 | 数字，单位为美元，最多两位小数（服务端统一 `round2`） |
| 时间 | ISO 8601 字符串，UTC，例：`2026-11-13T03:18:14.789Z` |
| 分页 | 查询参数 `page`（从 1 开始）、`limit`；响应 `meta` 里带 `page / limit / total / hasMore` |
| 缓存 | 所有接口 `Cache-Control: no-store`，价格与库存不允许被中间层缓存 |
| 安全头 | `X-Content-Type-Options: nosniff` |

### 1.3 响应信封

**成功**（单对象）：

```json
{ "data": { "…": "…" } }
```

**成功**（列表 + 分页）：

```json
{
  "data": [ { "…": "…" } ],
  "meta": { "page": 1, "limit": 25, "total": 90, "hasMore": true }
}
```

**失败**（所有错误结构一致，不会出现裸字符串或 HTML 错误页）：

```json
{
  "error": {
    "code": "OUT_OF_STOCK",
    "message": "Only 2 left for Foxtrot Pendant Necklace / Gold.",
    "details": [{ "sku": "TG-101-GO", "requested": 3, "available": 2 }]
  }
}
```

> **前端必须按 `code` 分支，不要按 `message` 文案匹配。**文案会改，code 不会。

### 1.4 快速开始

```bash
# 健康检查
curl http://localhost:4600/api/v1/health

# 首屏数据（设置 + 导航 + 集合 + 赠品规则，一次拿全）
curl http://localhost:4600/api/v1/bootstrap

# 报价（把购物车换成真实商品 ID）
curl -X POST http://localhost:4600/api/v1/checkout/quote \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"productId":"TG-101","metal":"Gold","size":"16\"","qty":1}],
       "couponCode":"LASTGROVE10","shippingMethod":"Standard"}'

# 后台登录拿令牌
curl -X POST http://localhost:4600/api/v1/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@lastgrove.com","password":"<your-password>"}'

# 带令牌查订单
curl http://localhost:4600/api/v1/admin/orders?status=paid \
  -H "Authorization: Bearer <token>"
```

---

## 2 鉴权

### 2.1 机制

| 项 | 内容 |
| --- | --- |
| 方式 | Bearer Token（不透明字符串，非 JWT） |
| 传递 | `Authorization: Bearer <token>` |
| 有效期 | **12 小时** |
| 存储 | 服务端 `db.sessions` 持有，可**随时吊销**（登出、改密、禁用账号） |
| 密码存储 | `scrypt`（N=16384, r=8, p=1）+ 每账号随机盐；比对用定长比较防时序攻击 |

令牌存在服务端的好处是「登出即失效」。JWT 做不到——除非再维护一张黑名单，那等于又存了一份会话。

### 2.2 权限位

鉴权只判**权限位**，不判角色。角色仅决定「默认授予哪些位」，改角色或调个人权限都不需要改接口代码。

| 权限位 | 覆盖的端点 |
| --- | --- |
| `metrics:read` | `GET /admin/metrics` |
| `orders:read` | `GET /admin/orders`、`GET /admin/orders/:number`、`GET /admin/export/orders.csv` |
| `orders:write` | `PATCH /admin/orders/:number/status`、`POST /admin/orders/:number/tracking` |
| `orders:refund` | `POST /admin/orders/:number/refund` |
| `products:read` | `GET /admin/products`、`GET /admin/products/:id`、`GET /admin/inventory`、`GET /admin/stock-ledger`、`GET /admin/reviews`、`GET /admin/export/products.csv` |
| `products:write` | `POST /admin/products`、`PATCH /admin/products/:id`、`DELETE /admin/products/:id`、`POST /admin/products/:id/duplicate`、`POST /admin/uploads`、`POST /admin/products/import/preview`、`POST /admin/products/import`、`GET /admin/products/import/template`、`PATCH /admin/reviews/:id` |
| `inventory:write` | `POST /admin/products/:id/variants/:sku/restock` |
| `customers:read` | `GET /admin/customers`、`GET /admin/export/customers.csv` |
| `coupons:write` | `GET /admin/coupons`、`POST /admin/coupons`、`DELETE /admin/coupons/:code` |
| `settings:write` | `GET /admin/settings`、`PATCH /admin/settings`、`GET /admin/audit-log`、`GET /admin/export/tax.csv` |
| `staff:read` | `GET /admin/staff` |
| `staff:write` | `POST /admin/staff`、`PATCH /admin/staff/:id`、`DELETE /admin/staff/:id` |
| `posts:write` | `GET /admin/posts`、`GET /admin/posts/:id`、`GET /admin/post-meta`、`POST /admin/posts`、`PATCH /admin/posts/:id`、`DELETE /admin/posts/:id` |

**预置角色（共 13 个权限位）：**

| 角色 | 权限位 | 说明 |
| --- | --- | --- |
| `owner` | 全部 13 项 | 店主。**恒为全权限**，不读库里那份数组（见 §5.16） |
| `ops` | 10 项：除 `settings:write`、`staff:read`、`staff:write` 外全有 | 日常运营，改不了运费/门槛/审计，也动不了人 |
| `support` | `metrics:read` `orders:read` `products:read` `customers:read` | 客服只读。不含 `posts:write`——客服改不了文案 |

> **退款单独一位 `orders:refund`**，不并进 `orders:write`。这是刻意的：能改订单状态和能把钱退出去，风险不是一个量级。

### 2.3 登录与登出

```bash
# 登录
curl -X POST http://localhost:4600/api/v1/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@lastgrove.com","password":"<your-password>"}'
```

```json
{
  "data": {
    "token": "9f2c…",
    "expiresAt": "2026-11-13T15:18:14.789Z",
    "staff": {
      "id": "S001",
      "email": "owner@lastgrove.com",
      "name": "Owner",
      "role": "owner",
      "permissions": ["metrics:read", "orders:read", "…"]
    }
  }
}
```

登录失败一律返回 `401 UNAUTHORIZED` + 文案 `Invalid email or password.`，**不区分"账号不存在"和"密码错误"**——区分了就等于送给撞库一把用户名枚举器。同一 IP 每 5 分钟限 10 次。

---

## 3 限流

内存令牌桶，按 **IP + 路由组** 计数。超限返回 `429 RATE_LIMITED`，响应不带 `Retry-After`（前端按固定退避重试）。

| 路由组 | 阈值 | 为什么是这个数 |
| --- | --- | --- |
| `POST /checkout/quote` | 60 次 / 分钟 / IP | 结算页随输入频繁报价，放宽但要防刷 |
| `POST /orders` | 20 次 / 分钟 / IP | 正常用户不可能超过 |
| `GET /orders/lookup` | 30 次 / 分钟 / IP | 订单号可枚举，必须限 |
| `POST /admin/login` | 10 次 / 5 分钟 / IP | 防撞库 |

> 单机内存计数，多实例部署时会退化成「每实例各自计数」。上生产前应换成 Redis 计数或网关限流，这条已记入 SDD 演进路线。

---

## 4 两个跨接口的机制

### 4.1 报价锁（quote）

**问题**：用户在结算页看到 $147.60，提交时价格已经变了，怎么办？

**做法**：结算页先调 `/checkout/quote` 拿一张 15 分钟有效的凭证，下单时必须带上它。

```
POST /checkout/quote   →  { quoteId: "Q3f2a…", total: 147.60, expiresAt: … }
POST /orders  { quoteId: "Q3f2a…", … }   ← 必须带
```

| 情况 | 返回 | 前端处理 |
| --- | --- | --- |
| 未带 `quoteId` | `422 QUOTE_REQUIRED` | 回结算页重新报价 |
| 报价过期（>15 分钟） | `422 QUOTE_EXPIRED` | 静默重新报价 |
| 重算金额与报价不一致 | `422 PRICE_CHANGED` + 新旧金额 | **展示新旧金额让用户确认**，不静默按新价成交 |
| 报价已被用过 | `422 QUOTE_REQUIRED` | 一张报价只能成交一次 |

重算时会把库存、优惠券、运费全部重新校验一遍——报价是 15 分钟前的快照，这期间商品可能被别人买走、券可能被用完。

### 4.2 幂等下单

**问题**：弱网下用户连点 5 次，会不会出 5 单？

**做法**：`POST /orders` 接受 `Idempotency-Key` 请求头。首次请求建单并记住「键 → 单号」；同键重复请求直接返回原订单，不再建单。

```bash
curl -X POST http://localhost:4600/api/v1/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 1f0c9b7e-4b2a-4f1e-9c3d-8a7e6f5d4c3b' \
  -d '{ … }'
```

重复请求的响应体多一个字段，便于前端识别：

```json
{ "data": { "order": { "number": "#TG1131", "…": "…" }, "replayed": true } }
```

键的留存期与报价一致（15 分钟），最多保存 500 个，超出后淘汰最早的。

---

## 5 端点清单

图例：🔓 公开 · 🔐 需登录 · 🔑 需指定权限位

### 5.1 系统

#### 🔓 `GET /health`

健康检查。用于部署探活与运维巡检。

```json
{ "data": { "status": "ok", "version": "1.0.0", "products": 36, "orders": 90, "time": "2026-11-13T03:18:14.789Z" } }
```

#### 🔓 `GET /bootstrap`

**首屏一次性拿全**：站点设置 + 导航 + 全部可见集合 + 赠品规则。原本要 4 个串行请求，合成一个后弱网首屏快一档。

```json
{
  "data": {
    "settings": {
      "brand": "LASTGROVE",
      "tagline": "…",
      "currency": "USD",
      "freeShippingThreshold": 95,
      "standardShipping": 6.9,
      "expressShipping": 19.9,
      "giftThreshold": 120,
      "giftName": "Mini Shell Studs",
      "announce": "Free shipping over $95 · Lifetime color guarantee",
      "heroEyebrow": "New season · stainless steel",
      "heroTitle": "…",
      "heroBody": "…",
      "bestSellersEyebrow": "As seen on TikTok",
      "storeOpen": true,
      "returnWindowDays": 30,
      "socials": { "instagram": "https://instagram.com/lastgrove", "pinterest": "", "tiktok": "" }
    },
    "pages": { "about": { "title": "…", "intro": "…" } },
    "collections": [
      { "handle": "necklaces", "title": "Necklaces", "level": 1, "parent": null,
        "nav": true, "visible": true, "order": 5, "intro": "…", "count": 14 }
    ],
    "nav": [ { "handle": "best-sellers", "title": "Best Sellers" } ],
    "giftRule": { "threshold": 120, "name": "Mini Shell Studs", "value": 24, "sku": "TG-901-GO" }
  }
}
```

`storeOpen: false` 时前台应显示"暂时停止接单"，报价接口会直接返回 `STORE_CLOSED`。

`settings.socials`（v1.6 新增）：三个键恒存在，未配置是空串。**前端必须按「有值才渲染」处理**，不能给空串兜一个默认链接 —— 页脚那三个图标此前全指向 `/#/pages/about`，点得开但不是它说的那件事，比不显示更伤信任。`pinterest` / `tiktok` 未配置时正确表现是页脚只有 Instagram 一个图标，而不是三个之中两个假的。

---

### 5.2 商品目录（公开）

#### 🔓 `GET /products`

商品列表。返回数组（不含分页元信息）。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `collection` | string | — | 集合 handle，如 `necklaces` |
| `metal` | string | — | `Gold` / `Silver`，**只返回该金属有货的商品** |
| `price` | string | — | 价格带：`under-70` / `70-100` / `over-100` |
| `stock` | string | — | 传 `in` 表示只看有货 |
| `motif` | string | — | 题材，如 `celestial` |
| `q` | string | — | 关键词，匹配标题 + 描述 + 题材 + 集合名 |
| `sort` | string | `featured` | `featured` / `new` / `best` / `price-asc` / `price-desc` / `rating` |
| `page` | int | 1 | 页码 |
| `limit` | int | 24 | 每页条数，上限 48 |

```bash
curl 'http://localhost:4600/api/v1/products?collection=necklaces&metal=Gold&sort=price-asc&limit=2'
```

```json
{
  "data": [
    {
      "id": "TG-101",
      "handle": "foxtrot-pendant-necklace",
      "title": "Foxtrot Pendant Necklace",
      "price": 82,
      "compareAt": null,
      "currency": "USD",
      "images": ["assets/img/opt/p-necklace-fox-gold.jpg"],
      "motif": "woodland",
      "set": "",
      "category": "necklaces",
      "badge": "Best Seller",
      "rating": 4.8,
      "reviewCount": 128,
      "description": "…",
      "details": { "material": "316L stainless steel", "plating": "PVD gold" },
      "sizes": ["16\"", "18\""],
      "collections": ["necklaces", "best-sellers"],
      "inStock": true,
      "totalStock": 17,
      "variants": [
        { "sku": "TG-101-GO", "metal": "Gold", "price": 82, "inStock": true, "stock": 9 },
        { "sku": "TG-101-SI", "metal": "Silver", "price": 82, "inStock": true, "stock": 8 }
      ],
      "createdAt": "2026-09-12T00:00:00.000Z"
    }
  ]
}
```

> **`cost`（成本）字段不会出现在任何公开接口里。**`publicProduct()` 是唯一的出口，成本、供应商、内部备注一律不出门。

#### 🔓 `GET /products/search`

同上，但返回带 `meta` 的分页结构。后台与管理台用。

```json
{ "data": [ … ], "meta": { "page": 1, "limit": 24, "total": 36, "hasMore": true } }
```

#### 🔓 `GET /products/:handle`

商品详情，附已审核评价与相关推荐。

```json
{
  "data": {
    "product": { "…": "同列表项结构" },
    "reviews": [
      { "id": "R001", "name": "Sarah M.", "rating": 5,
        "title": "Wore it in the ocean for two weeks straight",
        "body": "…", "createdAt": "2026-11-12", "verified": true }
    ],
    "related": [
      { "id": "TG-104", "handle": "…", "title": "…", "price": 78, "image": "…" }
    ]
  }
}
```

只返回 `status === 'approved'` 的评价；下架或未审核的一律不出现。商品不存在或已下架统一返回 `404 NOT_FOUND`（不区分，避免探测草稿商品）。

#### 🔓 `GET /collections`

全部可见集合（`visible !== false`），含各集合的商品数 `count`。

#### 🔓 `GET /collections/:handle`

集合详情 + 该集合下的商品（分页）。

```json
{
  "data": [ … ],
  "meta": { "collection": { "handle": "necklaces", "title": "Necklaces", "count": 14 },
            "page": 1, "limit": 24, "total": 14, "hasMore": false }
}
```

#### 🔓 `GET /search`

轻量搜索，等价于 `GET /products?q=…&sort=…&limit=…`，返回数组。

---

### 5.3 结算（公开）

#### 🔓 `POST /cart/validate`

购物车校验。加购或打开购物车时调用，返回**服务端价格**，用于纠正前端可能过期的缓存价。

```json
// 请求
{ "items": [
  { "productId": "TG-101", "metal": "Gold", "size": "16\"", "qty": 2 }
] }
```

```json
// 响应
{
  "data": {
    "lines": [
      { "productId": "TG-101", "handle": "foxtrot-pendant-necklace",
        "title": "Foxtrot Pendant Necklace", "metal": "Gold", "size": "16\"",
        "qty": 2, "unitPrice": 82, "lineTotal": 164, "stock": 9 }
    ],
    "subtotal": 164,
    "currency": "USD"
  }
}
```

**前端传来的 `unitPrice` / `lineTotal` 会被完全忽略**，只采信 `productId / metal / size / qty`。这是防止改价的第一道关。

#### 🔓 `POST /coupons/validate`

单独校验优惠码（不生成报价，不发 quoteId）。用于结算页点"应用"时的即时反馈。

```json
// 请求
{ "code": "LASTGROVE10", "items": [ { "productId": "TG-101", "metal": "Gold", "qty": 2 } ] }
```

```json
// 响应
{ "data": { "code": "LASTGROVE10", "type": "percent", "value": 10,
            "discount": 16.4, "subtotal": 164, "afterDiscount": 147.6 } }
```

| 失败 code | HTTP | 触发条件 |
| --- | --- | --- |
| `COUPON_INVALID` + `details.reason = not_found` | 422 | 码不存在 |
| `COUPON_INVALID` + `expired` | 422 | 已过 `endsAt` |
| `COUPON_INVALID` + `not_started` | 422 | 未到 `startsAt` |
| `COUPON_INVALID` + `inactive` | 422 | `status` 不是 active |
| `COUPON_INVALID` + `exhausted` | 422 | 使用次数已达上限 |
| `COUPON_MIN_SUBTOTAL` | 422 | 未达门槛，`details` 带 `minSubtotal / subtotal / gap` |

> **过期判定优先于"未启用"判定。**一张 8 月就结束的券，用户看到"已过期"才合理，看到"未启用"会以为还有机会。

#### 🔓 `POST /checkout/quote`

**结算核心接口。**锁定价格、库存、运费、优惠、赠品，返回 15 分钟有效的 `quoteId`。

```json
// 请求
{
  "items": [
    { "productId": "LG-101", "metal": "Gold", "size": "16\"", "qty": 2 }
  ],
  "couponCode": "LASTGROVE10",
  "shippingMethod": "Standard",
  "state": "CA"
}
```

`items` 限制：最多 **30 行**，每行最多 **10 件**。

`state`（v1.4 新增，可选）：收货州，两位码或全名都行（`CA` / `California` / `Brooklyn, New York` 都能归一）。不传 = 不知道发哪儿 = **不收税**，而不是"按某个默认州收"。前端在结算页填完州就要传，否则下单时会因为报价与订单税额对不上被判 `PRICE_CHANGED`。

```json
// 响应
{
  "data": {
    "quoteId": "Q3f2a9c1b7e4d8a0f2",
    "expiresAt": "2026-11-13T03:33:14.789Z",
    "lines": [
      { "productId": "LG-101", "title": "Foxtrot Pendant Necklace",
        "metal": "Gold", "size": "16\"", "qty": 2, "unitPrice": 88, "lineTotal": 176 }
    ],
    "gift": {
      "productId": "LG-901", "sku": "LG-901-GO", "title": "Mini Shell Studs",
      "metal": "Gold", "qty": 1, "isGift": true,
      "image": "assets/img/opt/p-earrings-hoop-gold.jpg"
    },
    "subtotal": 176,
    "discount": 17.6,
    "shipping": 0,
    "tax": 11.48,
    "taxRate": 0.0725,
    "taxState": "CA",
    "total": 169.88,
    "shippingMethod": "Standard",
    "couponCode": "LASTGROVE10",
    "freeShipGap": 0,
    "giftGap": 0,
    "currency": "USD",
    "dutiesIncluded": true
  }
}
```

**金额计算顺序**（固定，不允许前端自行推算）：

1. 小计 = Σ（单价 × 数量），按商品原价，**不含赠品**
2. 优惠 = 券 / 自动折扣（按 SDD 约定的四步顺序，含最低金额保护）
3. 运费 = 按折后金额与配送方式判定；达免邮门槛则 0
4. 税 = (小计 − 优惠 + 运费) × 该州税率；`settings.tax.shipTaxable=false` 时运费不计入税基
5. 总额 = 小计 − 优惠 + 运费 + 税
6. 赠品 = 折后金额达门槛**且赠品有货**时出现，作为 0 元行

`taxRate` / `taxState` 回传是为了让前端能显示「Tax (CA) $11.48」而不是一个没有出处的数字；`taxState` 为空表示该州未注册、不收税。

`freeShipGap` / `giftGap` 是给"再买 $X 免运费"进度条用的，已按折后金额算好，前端直接用。

| 失败 code | HTTP | 说明 |
| --- | --- | --- |
| `STORE_CLOSED` | 422 | 后台关了接单开关 |
| `OUT_OF_STOCK` | 409 | 某 SKU 不足，`details` 带 `sku / requested / available`。**整单拒绝，不部分成交** |
| `EMPTY_CART` | 400 | `items` 为空 |
| `TOO_MANY_LINES` | 400 | 超过 30 行 |
| `RATE_LIMITED` | 429 | 超过 60 次/分钟 |

> **v1.3 补记**：`quote` 的响应里**没有税额字段**。售价已含关税（`dutiesIncluded: true`），但**美国各州销售税未收取**。原设计由 Stripe Tax 计算，因本站未接 Stripe，该能力缺失。见 FRD §13 P-01。

#### 🔓 `GET /payments/methods`

结算页用它决定渲染哪种支付界面。**支付按钮不由前端写死**，跟随当前启用通道。

```json
{ "data": {
    "provider": "paypal",
    "label": "PayPal",
    "supports": ["paypal", "card"],
    "flow": "async",
    "configured": true,
    "all": [
      { "id": "mock",      "label": "模拟通道",  "configured": true,  "active": false },
      { "id": "stripe",    "label": "Stripe",    "configured": false, "active": false },
      { "id": "airwallex", "label": "Airwallex", "configured": false, "active": false },
      { "id": "paypal",    "label": "PayPal",    "configured": true,  "active": true  }
    ]
} }
```

`configured=false` 时前台必须显示「暂不可用」，**不能放一个点了会报错的按钮**。`all` 里带 `configured` 标记，让后台一眼看出「切了通道但密钥没填」。

#### 🔓 `POST /payments/capture`

买家从 PayPal 回跳后调用，把「已批准」变成「已扣款」。**没有这一步，钱永远停在待捕获，订单永远停在 `pending_payment`。**

```json
{ "sessionId": "3O190472WX1234567" }
```

`sessionId` 取自回跳 URL 的 `token` 参数（即 PayPal 的 order id，本地存在 `payment.reference`）。**这里不能用订单号**——创建支付会话时本地订单还没落库，回跳链接里带不了订单号。

```json
// 成功
{ "data": { "order": { "…": "…" }, "captured": true } }
// 已付过（回跳与 webhook 并发，后到的那条）
{ "data": { "order": { "…": "…" }, "captured": true, "already": true } }
// 买家取消 / 卡被拒 / 余额不足
{ "data": { "order": { "…": "…" }, "captured": false, "status": "PAYER_ACTION_REQUIRED" } }
```

| 情形 | HTTP | 处理 |
| --- | --- | --- |
| `captured:false` | **200** | 买家取消是正常分支，**不是错误**。订单保持 `pending_payment` 可再次支付，**不标 cancelled**（取消了客户就再也付不了） |
| `CAPTURE_NOT_REQUIRED` | 422 | 当前通道是 `sync` 模式（mock），不需要捕获 |
| `ORDER_NOT_PAYABLE` | 422 | 订单已进入不可支付状态（如已退款） |
| 找不到会话 | 404 | `sessionId` 无对应订单 |

---

### 5.4 订单（访客，无需登录）

本站**不做用户账户体系**，订单查询靠「单号 + 邮箱」双因子。

#### 🔓 `POST /orders`

创建订单。必须带 `quoteId`，强烈建议带 `Idempotency-Key`。

```json
// 请求
{
  "quoteId": "Q3f2a9c1b7e4d8a0f2",
  "email": "sarah@example.com",
  "firstName": "Sarah",
  "lastName": "Miller",
  "address": {
    "line1": "1420 Ocean Ave",
    "line2": "Apt 3B",
    "city": "Santa Monica",
    "state": "CA",
    "zip": "90401",
    "country": "United States"
  },
  "note": "Please leave at the door",
  "payment": { "last4": "4242" }
}
```

`country` 只接受 `United States` / `Canada` / `United Kingdom`，其余返回 `400` 并在 `details` 里指明字段。

```json
// 响应 201
{
  "data": {
    "order": {
      "number": "#TG1131",
      "email": "sarah@example.com",
      "name": "Sarah Miller",
      "status": "paid",
      "statusLabel": "Paid",
      "items": [
        { "productId": "TG-101", "title": "Foxtrot Pendant Necklace", "variant": "Gold",
          "size": "16\"", "unitPrice": 82, "qty": 2 },
        { "productId": "TG-901", "title": "Mini Shell Studs", "variant": "Gold",
          "size": "", "unitPrice": 0, "qty": 1, "isGift": true }
      ],
      "subtotal": 164,
      "shipping": 0,
      "discount": 16.4,
      "total": 147.6,
      "address": { "…": "…" },
      "shippingMethod": "Standard",
      "tracking": "",
      "carrier": "",
      "createdAt": "2026-11-13T03:18:16.000Z",
      "couponCode": "LASTGROVE10",
      "gift": { "name": "Mini Shell Studs", "value": 24 },
      "payment": { "provider": "stripe", "mode": "simulated", "reference": "sim_9a2f1c", "last4": "4242" },
      "quoteId": "Q3f2a9c1b7e4d8a0f2"
    }
  }
}
```

**这个接口一次性完成 7 件事**（全部在同一事务里，任一失败全部回滚）：

1. 校验收货信息（邮箱格式、地址完整性、配送国家）
2. 找到并校验报价（存在 / 未过期）
3. **重算金额**并与报价逐项比对，不一致拒单
4. 二次校验库存与券（券门槛、余量、有效期）
5. 扣主商品库存 + 扣**赠品库存**，每个 SKU 写一条 `sale` 流水
6. 券使用次数 +1；客户档案按**小写邮箱**匹配更新（新客户则建档）
7. 报价用掉即失效

| 失败 code | HTTP | 前端处理 |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | 高亮 `details[].field` 对应的输入框 |
| `QUOTE_REQUIRED` / `QUOTE_EXPIRED` | 422 | 回结算页重新报价 |
| `PRICE_CHANGED` | 422 | 提示"金额已更新"，展示新旧总额让用户确认 |
| `OUT_OF_STOCK` | 409 | 标注具体行，提示减量 |
| `COUPON_INVALID` | 422 | 提示券已失效，从摘要里移除 |
| `RATE_LIMITED` | 429 | 禁用按钮并退避重试 |

#### 🔓 `GET /orders/lookup`

访客查单。**单号与邮箱必须同时匹配**，任一不对都返回 `404`（不泄露"单号存在但邮箱错"）。

```bash
curl 'http://localhost:4600/api/v1/orders/lookup?number=%23TG1131&email=sarah@example.com'
```

`number` 可以带或不带 `#`，服务端自动补齐。

#### 🔓 `GET /orders/:number?email=…`

同上，路径参数形式。邮箱通过 query 传，也必须匹配。

#### 🔓 `POST /orders/:number/cancel`

访客自助取消。**仅限未发货**（`paid` / `fulfilling`），需邮箱验证。

```json
{ "email": "sarah@example.com" }
```

取消会回补库存、写 `cancelled` 流水、释放券、冲减客户累计消费。已发货订单返回 `409`，提示走退货流程。

---

### 5.5 后台 · 认证

#### 🔐 `POST /admin/login` / `POST /admin/logout` / `GET /admin/me`

`/admin/me` 返回当前登录者与权限位，**后台首屏用它决定显示哪些菜单**——没权限的入口直接不渲染，而不是点了才报 403。

`role` 是 `owner` 时，`permissions` **恒为全部权限位**（见 §5.16 末尾「owner 恒为全权限」）；其他角色以库里的数组为准。

```json
{ "data": { "staff": { "id": "S001", "email": "…", "name": "Owner",
                       "role": "owner", "permissions": ["…"] } } }
```

---

### 5.6 后台 · 看板

#### 🔑 `GET /admin/metrics?days=30`

经营看板。`days` 取 1–365，默认 30。

```json
{
  "data": {
    "window": 30,
    "gmv": 2387.5,
    "orders": 26,
    "units": 37,
    "aov": 91.83,
    "refundRate": 10.3,
    "gmvDelta": 10.9,
    "series": [ { "date": "2026-10-15", "revenue": 148.0 } ],
    "topProducts": [ { "title": "Foxtrot Pendant Necklace", "units": 6, "revenue": 492 } ],
    "lowStock": [ { "sku": "TG-802-SI", "title": "…", "metal": "Silver", "stock": 2 } ],
    "pendingReviews": 8,
    "awaitingShipment": 5
  }
}
```

`refundRate` 超过 8% 时前台应标红——这是运营定的健康线。

---

### 5.7 后台 · 订单

#### 🔑 `GET /admin/orders`

| 参数 | 说明 |
| --- | --- |
| `status` | `paid` / `fulfilling` / `fulfilled` / `completed` / `cancelled` / `refunded` |
| `q` | 关键词，匹配单号 / 邮箱 / 姓名（不区分大小写） |
| `page` / `limit` | 默认 1 / 25，`limit` 上限 100 |

```json
{ "data": [ { "number": "#TG1131", "email": "…", "name": "Sarah Miller",
              "status": "paid", "statusLabel": "Paid", "total": 147.6,
              "items": 2, "createdAt": "…", "shippingMethod": "Standard" } ],
  "meta": { "page": 1, "limit": 25, "total": 90, "hasMore": true } }
```

列表里的 `items` 是**件数**（数字），不是明细数组——列表不需要明细。

#### 🔑 `GET /admin/orders/:number`

订单详情，额外返回 `allowedTransitions`。

```json
{ "data": { "order": { "…": "…" }, "allowedTransitions": ["fulfilling", "cancelled", "refunded"] } }
```

**后台界面必须只渲染 `allowedTransitions` 里的按钮**，从源头杜绝非法操作，而不是点了再报错。

#### 🔑 `PATCH /admin/orders/:number/status`

```json
{ "status": "fulfilling" }
```

状态机（单向，终态不可回退）：

```
paid       → fulfilling | cancelled | refunded
fulfilling → fulfilled  | cancelled | refunded
fulfilled  → completed  | refunded
completed  → refunded
refunded / cancelled    → 终态
```

不在表中的转换返回 `422 INVALID_TRANSITION`。**目标为 `refunded` 时本接口会拒绝**，必须走 `/refund` 专用接口——否则库存不回补、券不释放、客户消费不减。

#### 🔑 `POST /admin/orders/:number/refund`

**两种退法：整单退、按行退。** 不传 `items` 就是整单退；传了 `items` 就只退那几件。

```json
// 整单退
{ "restock": true }

// 按行退（v1.4 新增）
{
  "restock": true,
  "reason": "Too small",
  "items": [
    { "sku": "LG-101-GO", "qty": 1 },
    { "sku": "LG-102-SI", "qty": 1 }
  ]
}
```

`restock` 默认 `true`（退货入库）；用户在收到货前退款可选 `false`（货还在路上，不回补）。整单退时 `amount` 省略表示退剩余全额。

```json
// 响应
{ "data": {
    "order": { "…": "…" },
    "refunded": 79.2,          // 这一次退了多少钱
    "refundedTotal": 79.2,     // 这张单累计退了多少钱
    "fullyRefunded": false,    // 是否已退完（决定订单状态）
    "restocked": true
} }
```

**按行退的金额口径**（写死在服务端，前端不重算 —— 两边各算一遍迟早算出两个数，客户只认少的那个）：

| 组成 | 规则 |
| --- | --- |
| 商品 | 该行单价 × 退的件数，再扣掉这一行按金额占比分摊的优惠 |
| 税 | 该行按净额占比分摊的税额。**退了货不退税收，等于替州里多吃一笔** |
| 运费 | 只有**最后一件付费商品**退完时才退。部分退不退运费 |

分摊用「累计目标法」：按累计退掉的数量算出这一行"一共该退多少"，减去已退的部分。所以同一行分三次退也不会攒出四舍五入的偏差。全部以内部分计算，最后一行吃余数。

`fullyRefunded=true` 时走完整回滚：状态改 `refunded`、释放券、客户单数 −1、库存补齐（含赠品）。**`false` 时订单状态不变**，只冲减客户累计消费额并打上 `partiallyRefunded` —— 不能把"下过单"这件事也抹掉，否则复购次数与 VIP 分层会凭空掉一级。

退款记录写在 `order.refunds[]`，每条含 `{ id, at, amount, restock, reason, items[{sku, qty, amount, tax}] }`。`order.refundedTotal` / `order.refundedTax` 是累计值。

| 失败 code | 说明 |
| --- | --- |
| `CONFLICT` | 已退款 / 已取消的订单不能退；`pending_payment` 也不能退（钱没收到，退的是空气） |
| `BAD_REQUEST` | `items` 里找不到这一行，或 `qty` 超过剩余可退件数 |
| `FORBIDDEN` | 缺 `orders:refund` 权限位 |

#### 🔑 `POST /admin/orders/:number/tracking`

```json
{ "tracking": "9400 1000 0000 0000 0000 00", "carrier": "USPS" }
```

填写运单号后，若订单处于 `paid` / `fulfilling`，**自动推进到 `fulfilled`**，避免运营忘记改状态导致客户看不到物流。

**v1.3 起这个接口多了三件事**（原 v1.2 只存单号）：

| 变化 | 说明 |
| --- | --- |
| **保存即订阅 17TRACK** | 单号变化时自动 `register`；同一单号只订一次（依据 `trackingState.registeredFor`），避免重复计费 |
| **发出货信** | 由 `notify.claim(o,'shippedAt')` 去重，同一单只发一封 |
| **承运商白名单** | `carrier` 取值：`USPS` / `UPS` / `FedEx` / `DHL` / `Canada Post` / `Royal Mail` / `Other`。**不再自由文本、不再自动生成假单号** |

```json
// 响应（v1.3）
{ "data": {
    "order": { "…": "…" },
    "sync": { "ok": true, "registered": true, "events": 16, "status": "InTransit" }
} }
```

`sync.ok=false` 时订单照常保存运单号，只是轨迹暂不可用。`sync.reason` 取值与处理：

| reason / 错误码 | 含义 | 前台表现 |
| --- | --- | --- |
| `not-configured` | 未配 `TRACK17_KEY` | 显示单号，无轨迹区 |
| `-18019823` | 承运商政策拦截（试用额度下 USPS） | 「自动更新暂不可用，可点单号去承运商官网查」 |
| `-18019901` | 该单号已注册过 | **按成功处理**（单号复用时必然遇到） |
| `network` | 网络异常，未写订阅标记 | 下次刷新自动重试 |

#### 🔑 `POST /admin/orders/:number/tracking/refresh`

权限 `orders:write`。手动拉一次轨迹，**不消耗额度**（走 `gettrackinfo` 而非 `register`），客户催单时用。

```json
{ "data": { "order": { "…": "…" }, "sync": { "ok": true, "events": 16, "status": "Delivered" } } }
```

无运单号时返回 `400`。

#### 🔑 `GET /admin/tracking/quota`

权限 `orders:read`。订阅额度读数。后台设置页的 `Tracking quota` 面板消费此接口。

```json
{ "data": { "configured": true,
  "quota": { "total": 100, "used": 13, "remain": 87, "todayUsed": 3, "maxDaily": 100 } } }
```

未配密钥时返回 `{ "configured": false }`；上游异常时返回 `{ "configured": true, "error": "…" }`，**不抛 5xx**——这是一个状态查询接口，查不到额度不该让后台页面报错。

**额度语义（官方计费规则，直接决定成本，改代码前先读这段）**

| 规则 | 影响 |
| --- | --- |
| 免费账户每月 **100** 个订阅额度，1 号重置，**月底清零不累积** | 上个月用不完的不能挪到下个月；旺季前要提前买 |
| **只有 `register` 扣额度**（1 个单号 1 个额度） | 订阅成功后的查询、刷新、webhook 推送、自动追踪**全部不扣**。一次订阅，终身免费查 |
| 注册时传 `lang` 会额外扣 1（`registration + translation = 2`） | **代码刻意不传 `lang`**。本站只发美/加/英，承运商轨迹本就是英文，传了等于把 100 单砍成 50 单 |
| 同一单号注册到不同承运商各扣 1 | 所以 `register` 也不传 `carrier`，让 17TRACK 自己识别，避免重复订阅 |

**额度耗尽时的行为**：`register` 返回 `-18019908`（额度用完）或 `-18019907`（撞当日上限）。这两类**不写进订单的「单号无效」**，而是单独标记并在 `trackingState.error` 上写明「本月额度已用完，1 号恢复」。**保存运单号、发发货信、订单转 `fulfilled` 全部照常** —— 物流是体验问题，不能把发货动作搞挂。

#### 🔑 `GET /admin/tracking/health`

权限 `orders:read`。配置自检：密钥是否配置、已订阅单数、最近一次回调时间。

---

### 5.8 后台 · 商品与库存

#### 🔑 `GET /admin/products?q=…`

后台商品列表，含 `version`；`cost`（成本）**仅 `role=owner` 返回，ops 拿到 `null`**。`q` 同时匹配标题与商品 ID。

```json
{ "data": [ { "id": "TG-802", "handle": "ocean-gift-set", "title": "Ocean Gift Set",
              "price": 128, "compareAt": null, "cost": 32, "stock": 21, "active": true,
              "badge": null, "category": "necklaces", "image": "assets/img/opt/p-…jpg",
              "variants": [ { "sku": "TG-802-GO", "metal": "Gold", "stock": 11, "price": 128 } ],
              "updatedAt": "2026-11-14T03:20:11.402Z", "version": 4 } ] }
```

> 成本为什么按角色区分：ops 能改价，但不需要知道进货成本。只挡列表不挡写接口也没用——`PATCH` 会原样回吐 `product`，ops 调一次就看见了，所以列表、详情、写返回、报错文案四处都做了处理。

#### 🔑 `GET /admin/products/:id`

编辑抽屉用，一次返回全部字段（含 `images` / `sizes` / `collections` / `details` / `variants`）。`:id` 接受商品 ID 或 handle。

#### 🔑 `POST /admin/products`

```json
{ "title": "Moonlit Hare Necklace", "cat": "necklaces", "price": 76, "cost": 19.5,
  "desc": "…", "motif": "hare", "set": "woodland", "badge": "New",
  "compareAt": 92, "sizes": ["16in", "18"], "collections": ["necklaces", "new"],
  "images": [], "variants": [ { "metal": "Gold", "stock": 11 }, { "metal": "Silver", "stock": 10 } ] }
```

**新建一律是草稿**（`active=false`）：填一半、没图、库存没核对的商品直接上架，会被顾客看到并下单。

服务端自动生成：`id`（`TG-` + 现有最大序号 +1）、`handle`（标题转 slug，撞名加 `-2`）、缺失的 `sku`（`TG-<编号>-<GO|SI|RO>`）、`createdAt` / `version=1`。
每个变体的初始库存会写一条 `initial` 流水。

| 失败 code | 触发条件 |
| --- | --- |
| `400` + `details[].field` | 标题空、品类不在枚举内、价格 ≤ 0、金属非法、SKU 重复、图片超过 6 张或路径非法 |
| `422 PRICE_BELOW_COST` | 售价比成本低（ops 收到的是脱敏文案，不带金额） |
| `403 FORBIDDEN` | ops 试图设置 `cost` |

#### 🔑 `PATCH /admin/products/:id`

```json
{ "title": "…", "desc": "…", "cat": "rings", "motif": "shell", "set": "ocean",
  "badge": "Bestseller", "price": 88, "cost": 26, "compareAt": 110, "active": true,
  "sizes": ["7in"], "collections": ["rings"], "images": ["uploads/p-xxx.jpg"],
  "variants": [ { "metal": "Gold", "sku": "TG-803-GO", "price": 88, "stock": 12 } ],
  "version": 3 }
```

| 字段 | 说明 |
| --- | --- |
| `title` / `desc` | 最长 120 / 2000 字 |
| `cat` | 枚举：`necklaces` `bracelets` `anklets` `rings` `hair` |
| `motif` / `set` / `badge` | 图案 / 系列 / 角标；`badge` 只接受 `New`、`Bestseller`，传 `null` 清除 |
| `price` | 必须 > 0 且 **不得低于 `cost`**，否则 `422 PRICE_BELOW_COST`。未同时提交变体表时，变体价按原比例跟随主价 |
| `cost` | 单位成本，**仅 owner 可写**，ops 传了返回 `403` |
| `compareAt` | 划线价，必须高于售价，传 `null` 清除 |
| `active` | 上架 / 下架。**从草稿转上架时**校验：至少 1 张图、至少 1 个变体、价格 > 0，否则 `422 NEEDS_IMAGE / NEEDS_VARIANT / NEEDS_PRICE` |
| `images` | 1–6 个，元素必须是 `uploads/…` 或 `assets/img/…`，数组顺序即前台展示顺序 |
| `variants` | **整表替换**。库存变化写 `variant-adjust` 流水，新增变体写 `variant-add`；商品 `stock` 自动重算为各变体之和 |
| `sizes` | 最多 5 项，`16in` / `16"` 会统一成 `16"` |
| `collections` | 只接受已存在的集合 handle，未知的静默丢弃 |
| `handle` | 只在显式传入时修改。**改标题不会自动改 URL**——那会让已投放的链接全部 404 |
| `version` | **乐观锁**。带上读到的版本号，不一致返回 `409` + `details.currentVersion` |

乐观锁的意义：两个人同时改同一件商品的价格，后保存的人必须知道前一个人改了什么，而不是静默覆盖。

#### 🔑 `POST /admin/products/:id/duplicate`

复制为新草稿：标题加 `(copy)`、handle 加 `-copy`、**各变体库存归零**、评分与销量清零。库存归零是因为复制出来的数字是账面的，不能凭空变成可售。

#### 🔑 `DELETE /admin/products/:id`

| 失败 code | 触发条件 |
| --- | --- |
| `409 CONFLICT` | 该商品出现在订单里，响应带 `details.orders`（订单数）。硬删会让历史订单的商品名变空、对账断链，只能下架 |
| `200` | 无订单引用，连同其记录一起删除；历史库存流水**保留** |

#### 🔑 `POST /admin/uploads`

```json
{ "dataUrl": "data:image/jpeg;base64,/9j/4AAQ…" }
```

图片上传走 base64 JSON 而不是 multipart：现有请求解析器是 JSON 解析器（上限 256 KB），写一个 multipart 解析器约 60 行且边界条件多。前端用 Canvas 把图压到最长边 1600 px、质量 0.82（通常 200–400 KB），只给这一个接口把上限放宽到 8 MB，其余接口维持 256 KB。

服务端**只认文件头，不认扩展名和 content-type**：JPG / PNG / WebP 三种魔数之外一律 `400 INVALID_IMAGE`。**明确拒绝 SVG** —— 它走 `<img>` 时不执行脚本，但有人直接打开链接就是 XSS。

```json
{ "data": { "path": "uploads/p-mwfvtoax-4f335c.jpg", "file": "p-mwfvtoax-4f335c.jpg", "bytes": 110568 } }
```

落盘位置 `/app/app/server/data/uploads/`（`lastgrove-data` 卷），容器重建不丢。`path` 直接写进商品的 `images` 数组。

未被任何商品引用、且超过 24 小时的文件，由每小时一次的清理任务删除（用户中途放弃编辑会留下这类孤儿文件）。

#### 🔓 `GET /uploads/:file`

商品图的公开读取端点。文件名白名单校验 + 路径解析后必须仍在 uploads 目录内，`/uploads/../../db.json` 这类请求返回 404。

> 单独一条路由，不能交给 SPA 静态兜底：兜底对未命中路径返回 `index.html`，图片 404 时浏览器会收到一段 HTML，表现为「裂图 + 控制台 MIME 报错」。

#### 🔑 `POST /admin/products/import/preview`

```json
{ "csv": "group,title,category,price,metal,stock\n…" }
```

**只校验、不写库。** 一次导入 100 行，中途失败一半而库里留下 50 个半成品是最难收拾的场面，所以必然有两段式。

一行 = 一个变体，相同 `group` 的行归并成同一商品的多个变体。

```json
{ "data": { "totalRows": 100, "groupCount": 42, "validGroups": 40, "errorCount": 3,
            "errors": [ { "line": 17, "column": "price", "message": "price must be greater than 0." } ],
            "warnings": [ { "line": 9, "column": "collections", "message": "unknown collection(s) skipped: gift-set" } ],
            "groups": [ { "key": "moonlit-hare", "title": "…", "category": "necklaces", "price": 76,
                          "variants": 2, "stock": 21, "handle": "moonlit-hare", "ok": true } ] } }
```

`errors` 精确到行号与列名。`ok=false` 的整组不会被导入——同款少一个颜色就进库，比整组失败更难排查。

#### 🔑 `POST /admin/products/import`

```json
{ "csv": "…", "mode": "valid-only" }
```

| `mode` | 行为 |
| --- | --- |
| `abort`（默认） | 有任何错误就整体拒绝，`422 IMPORT_HAS_ERRORS`，库中零变更 |
| `valid-only` | 跳过 `ok=false` 的整组，其余全部创建 |

导入的商品**全部是草稿**。返回 `{ created, skipped, products: [{id, handle, title, variants, stock}], errors }`。

CSV 列：`group`（必填，归并键）/ `title` / `handle`（可空，撞名自动加后缀）/ `category` / `price` / `cost` / `compareAt` / `metal`（必填）/ `sku`（可空）/ `stock`（必填）/ `variantPrice` / `desc` / `motif` / `set` / `badge` / `images`（`|` 分隔）/ `collections`（`|` 分隔）/ `sizes`（`|` 分隔，`16in` 自动转 `16"`）。

#### 🔑 `GET /admin/products/import/template`

返回带表头与两行示例的 CSV，`Content-Type: text/csv; charset=utf-8`，**带 UTF-8 BOM**（不带 BOM 时 Excel 双击打开会把中文认成 GBK 而乱码）。

#### 🔑 `POST /admin/products/:id/variants/:sku/restock`

```json
{ "qty": 20, "reason": "manual-restock" }
```

补货**不是把数字加上去就完事**——会写一条 `restock` 流水，记录变动量与变动后余额。`qty` 必须为正整数。

#### 🔑 `GET /admin/inventory`

按 SKU 列出库存与风险等级。

```json
{ "data": [ { "productId": "TG-802", "title": "…", "sku": "TG-802-SI",
              "metal": "Silver", "stock": 2, "price": 96,
              "risk": "reorder", "weeksOfCover": 1.4 } ] }
```

`risk` 取值：`out`（0 件）/ `reorder`（≤ 低库存阈值）/ `healthy`。按库存升序排列，最紧张的在前。

#### 🔑 `GET /admin/stock-ledger`

库存流水。`sku` / `productId` 可筛选，`limit` 默认 50、上限 200，按时间**倒序**返回。

```json
{ "data": [ { "id": "L983384f6", "sku": "TG-101-GO", "productId": "TG-101",
              "delta": -2, "reason": "sale", "refType": "order", "refId": "#TG1131",
              "balanceAfter": 15, "createdAt": "2026-11-13T03:18:15.729Z" } ] }
```

`reason` 取值：`seed`（开账）/ `sale`（卖出）/ `refund`（退款回补）/ `cancelled`（取消回补）/ `restock`（手动补货）/ `purchase-order`（采购入库）。

> **流水只追加，不提供修改或删除接口。**这是刻意的：能被改的流水等于没有流水。

---

### 5.9 后台 · 客户 / 优惠券 / 评价

#### 🔑 `GET /admin/customers`

按累计消费倒序。客户档案按**小写邮箱唯一**，不会因为大小写差异出现重复人。

```json
{ "data": [ { "id": "C003", "email": "rachel.adler@icloud.com", "name": "Rachel Adler",
              "orders": 3, "spent": 450.2, "tier": "VIP", "last": "2026-10-25T10:00:00.000Z" } ] }
```

`tier` 规则：≥3 单为 `VIP`，2 单为 `Repeat`，其余 `New`。

#### 🔑 `GET /admin/coupons`

```json
{ "data": [ { "code": "LASTGROVE10", "type": "percent", "value": 10,
              "minSubtotal": 0, "used": 84, "limit": 500,
              "startsAt": "2026-10-01", "endsAt": "2026-12-31",
              "status": "active", "note": "Welcome code, always on" } ] }
```

#### 🔑 `POST /admin/coupons`

```json
{ "code": "SPRING15", "type": "percent", "value": 15,
  "minSubtotal": 95, "limit": 300, "note": "Spring campaign" }
```

| 校验 | 规则 |
| --- | --- |
| `code` | `/^[A-Z0-9_-]{3,24}$/`，服务端自动转大写；重复返回 `409` |
| `type` | `percent` / `fixed`，缺省 `percent` |
| `value` | > 0；`percent` 时 ≤ 100 |
| `limit` | 省略表示不限量 |

新建后**立即在前台生效**，无需重启或清缓存。

#### 🔑 `DELETE /admin/coupons/:code`

删除优惠码。已使用过该码的订单不受影响（订单里存的是 `couponCode` 快照），但客户再输入该码会得到 `COUPON_INVALID`。

#### 🔑 `GET /admin/reviews?status=pending`

评价列表，可筛 `pending` / `approved` / `rejected`，倒序，最多 200 条。

#### 🔑 `PATCH /admin/reviews/:id`

```json
{ "status": "approved" }
```

只有 `approved` 的评价会出现在前台。审核动作写审计日志（谁在什么时候审的）。

---

### 5.10 后台 · 设置与审计

#### 🔑 `GET /admin/settings`

```json
{ "data": { "brand": "LASTGROVE", "currency": "USD",
            "freeShip": 95, "standardShip": 6.9, "expressShip": 19.9,
            "giftThreshold": 120, "lowStockThreshold": 8, "returnWindowDays": 30,
            "storeOpen": true, "content": { "announce": "…" },
            "socials": { "instagram": "https://instagram.com/lastgrove",
                         "pinterest": "", "tiktok": "" },
            "tax": { "rates": { "CA": 0.0725 } } } }
```

`socials` 恒为对象，三个键恒存在（未配置是空串，不是缺键）—— 后台表单靠这一点回填。

#### 🔑 `PATCH /admin/settings`

```json
{ "freeShip": 95, "standardShip": 6.9, "expressShip": 19.9,
  "giftThreshold": 120, "lowStockThreshold": 6, "storeOpen": true,
  "content": { "announce": "Black Friday −40%" },
  "socials": { "instagram": "https://instagram.com/lastgrove", "pinterest": "" } }
```

**所有改动立即反映到前台报价与页面**——这是「前后台共用同一份数据」的落点。改完不需要发布、不需要清缓存。

`giftThreshold` 同时写入 `settings` 与 `giftRule`，两处永远一致。

`socials` 的分支规则（v1.6）：

| 传入 | 结果 |
| --- | --- |
| 键不存在（`undefined`） | 保留原值不动 |
| `""` / 空白 | 存空串（= 没有这个账号，前台不渲染） |
| `https://…` 或 `http://…` | 存前 200 字符 |
| 其它（`instagram.com/x`、`@x`、`javascript:`） | **400**，`details[].field = socials.<key>` |

不做「自动补 https://」的容错。补了就等于猜：用户想填的是一个账号名，接口却把它变成一个看起来能用的链接，点过去 404。宁可在这里拦下来让人填完整。

**成功时一并 `meta.postsRev++`**。`/journal`、`/journal/<slug>` 的页头页脚是服务端预渲染后按 `meta.postsRev` 缓存复用的，而公告条、社交图标、免邮门槛都来自 `settings`——不作废这个键，店主刚填的 Instagram 在博客页看不见。代价是文章页首次请求回源一次，可以接受。

#### 🔒 四个导出端点（v1.6 起全部写审计）

| 端点 | 权限 | 审计 action | `meta.count` |
| --- | --- | --- | --- |
| `GET /admin/export/orders.csv` | `orders:read` | `export.orders` | 导出行数 |
| `GET /admin/export/tax.csv` | `settings:write` | `export.tax` | `null`（申报汇总，无「行」概念） |
| `GET /admin/export/products.csv` | `products:read` | `export.products` | 导出行数 |
| `GET /admin/export/customers.csv` | `customers:read` | `export.customers` | 客户总数 |

四个端点都返回 `Content-Type: text/csv; charset=utf-8`，**带 UTF-8 BOM**。

审计记录形如：

```json
{ "at": "2026-11-16T07:12:03.441Z", "staffId": "S001",
  "email": "owner@lastgrove.com", "action": "export.customers",
  "target": "csv", "meta": { "count": 56 } }
```

为什么 GET 也要记：这是后台里唯一能一次性带走全部客户资料的动作（邮箱 + 姓名 + 订单额 + 地址）。GDPR 的可追溯性、CCPA 的访问请求都要求能回答「谁在什么时候导了什么」；运营上也有用——名单出现在第三方平台时，先查得到是谁导的。写日志后显式 `store.flush()`：不 flush 就只存在内存里，进程重启即丢，等于没记。

#### 🔑 `GET /admin/audit-log`

最近 200 条特权操作。

```json
{ "data": [ { "id": "Amweedy84", "at": "2026-11-13T03:08:56.836Z",
              "staffId": "S001", "email": "owner@lastgrove.com",
              "action": "order.refund", "target": "#TG1131",
              "meta": { "restock": true, "amount": 147.6 }, "ip": null } ] }
```

`action` 命名规则：`<域>.<动词>`。已实现：`login`、`logout`、`order.status`、`order.refund`、`order.tracking`、`product.update`、`inventory.restock`、`coupon.create`、`coupon.delete`、`review.moderate`、`settings.update`、`collection.create`、`collection.update`、`collection.delete`、`custom.update`、`content.update`、`post.create`、`post.update`、`post.delete`、`export.orders`、`export.tax`、`export.products`、`export.customers`。

`export.*` 是 v1.6 新增的一族：`target` 恒为 `csv`，`meta.count` 记导出行数。读型操作进审计的不多，这一族是例外 —— 因为它读出来的东西可以整份带走。

---

### 5.11 后台 · 集合（A-06）

集合不是独立表 —— 它就是商品身上的一个 handle 数组。所以**商品数永远现算**，不落库：存一份冗余计数，迟早和商品对不上，后台显示 12 件、前台打开只有 10 件，是最难查的一类不一致。

#### 🔑 `GET /admin/collections`

```json
{ "data": [ { "handle": "best-sellers", "title": "Best Sellers", "nav": true,
              "level": 1, "parent": null, "menuGroup": null, "order": 1,
              "desc": "", "productCount": 10 } ] }
```

需要 `products:read`。

#### 🔑 `POST /admin/collections`

```json
{ "title": "Gifts under $80", "handle": "gifts-under-80", "desc": "One line shown on the collection page", "nav": true, "order": 12 }
```

`handle` 留空则从标题推导（小写、非字母数字转 `-`）。重名返回 **409 `COLLECTION_EXISTS`**。

#### 🔑 `PATCH /admin/collections/:handle`

```json
{ "title": "Gifts under $80", "nav": false, "order": 12, "desc": "…" }
```

`nav: false` 之后，**前台顶部菜单立刻不含它**（`bootstrap.nav` 就是按这个字段过滤的）。

#### 🔑 `DELETE /admin/collections/:handle`

集合里还有商品时返回 **409 `COLLECTION_NOT_EMPTY`**，`details.products` 给出还剩几件。

> 这条限制是刻意的：删掉集合后商品会从那个入口静默消失（列表页 404），而运营很难把两件事联系起来。要求先移空，是故意制造的一点不方便。

---

### 5.12 后台 · 内容（A-08）

编辑范围**明确到字段**：首页文案全量可改，内容页只到「标题 + 导语」。正文段落仍在 `app/web/assets/js/pages.js` —— 不在接口里假装能改，否则运营改完发现没生效，比没有这个入口更糟。

#### 🔑 `GET /admin/content`

```json
{ "data": {
    "brand": "LASTGROVE", "tagline": "Sea glass doesn't fade.",
    "content": { "announce": "Free shipping over $95 · …", "heroEyebrow": "Sea glass · 316L steel",
                 "heroTitle": "Sea glass doesn't fade.|Neither do we.", "heroBody": "…",
                 "bestSellersEyebrow": "As seen on TikTok" },
    "pages": { "about": { "slug": "about", "title": "Our story", "intro": "…" } }
} }
```

#### 🔑 `PATCH /admin/content`

```json
{ "brand": "LASTGROVE",
  "content": { "announce": "Black Friday −40% | Duties included", "bestSellersEyebrow": "As seen on TikTok" },
  "pages": { "about": { "title": "Our story", "intro": "A small studio…" } } }
```

`announce` 用 `|` 或 `·` 分隔多条，前台逐条轮播；`heroTitle` 用 `|` 断行（前半常规、后半斜体）。

需要 `settings:write` —— 内容与站点参数同属"能改变前台呈现"的写操作，共用权限位。

---

### 5.13 定制需求单（A-12）

前台提交 → 后台报价 → 成单。状态**单向**：`new → quoted → ordered → closed`，不允许回退（回退会让运营对一个已经报过价的单子重报一次）。

#### 🌐 `POST /custom-requests`（公开，无需登录）

```json
{ "email": "ann@example.com", "name": "Ann",
  "style": "Signet ring with a wave motif", "qty": 2, "dueDate": "2026-12-20",
  "notes": "Size 7, matte silver, no stone.",
  "refUrls": ["https://example.com/ref.jpg"] }
```

`email` 与 `notes` 必填（`notes` ≥ 10 字符）；`refUrls` 只接受 `http(s)`，最多 5 条，其余静默丢弃。

```json
{ "data": { "request": { "id": "CR1001", "status": "new", "createdAt": "2026-11-13T05:27:44.880Z" } } }
```

**这是唯一一个匿名写库的端点，所以限流按 IP 收紧到 6 次 / 10 分钟。**

#### 🔑 `GET /admin/custom-requests?status=new`

需要 `orders:read`。

#### 🔑 `PATCH /admin/custom-requests/:id`

```json
{ "status": "quoted", "quote": 180, "note": "Factory can do it, 10 working days" }
```

跳步或回退返回 **409 `BAD_TRANSITION`**，`message` 里列出当前允许的目标状态。

---

### 5.14 Webhook（公开，靠签名鉴权，v1.3 新增）

> 这两个端点**没有令牌**，任何知道地址的人都能打。它们的安全性完全建立在签名上。三个共同约定：
> ① **必须用原始字节验签**——JSON 解析再序列化会改变空格与键序，签名必然对不上；
> ② 验签失败返回 **400**，让上游停止无意义重投；伪造请求永远拿不到 200；
> ③ **幂等**，上游超时后会重投同一事件。

#### 🌐 `POST /payments/webhook/:provider`

`provider` 必须与当前 `PAYMENT_PROVIDER` 一致，**否则 400**。防止有人往 `/webhook/stripe` 打假事件，绕过「这单走哪个通道」的判断。

按 PayPal 订阅的四类事件处理：

| 事件 | 转为内部状态 | 处理 |
| --- | --- | --- |
| `CHECKOUT.ORDER.APPROVED` | `approved` | **服务端补一次 capture**（买家批准后关掉标签页时，这是唯一能收到钱的路），成功后转 `paid` |
| `PAYMENT.CAPTURE.COMPLETED` | `paid` | 订单转 `paid`，占用转实扣，发确认信（去重） |
| `PAYMENT.CAPTURE.DENIED` | `failed` | 仅当 `pending_payment` 时转 `cancelled`，回补库存并写 `payment_failed_release` 流水 |
| `PAYMENT.CAPTURE.REFUNDED` | `refunded` | 订单转 `refunded`，发退款信（去重） |

```json
// 正常
{ "data": { "received": true, "order": "#TG1135", "status": "paid" } }
// 未匹配到订单（返回 200，不是 404）
{ "data": { "received": true, "matched": false } }
// 重复事件
{ "data": { "received": true, "duplicate": true, "order": "#TG1135" } }
// 不关心的事件类型
{ "data": { "received": true, "ignored": true, "event": "CUSTOMER.CREATED" } }
```

| 失败 code | HTTP | 何时 |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | 空 body / 通道名不匹配 / **验签失败** |
| `WEBHOOK_VERIFY_UNAVAILABLE` | 502 | 验签过程中的**网络异常**（PayPal 需回调其接口验签）。不能当验签失败，也不能放行——502 让对方稍后重投 |
| `CAPTURE_UNAVAILABLE` | 502 | `approved` 事件里补 capture 抛异常。钱可能已在扣，不能默默吞掉 |

> **为什么未匹配订单要返回 200 而不是 404**：通道对 4xx 会持续重投，而这单可能压根不是本站发出的、或已被删除。记日志人工核对即可。
>
> **事件去重记录保留最近 2000 条**，防单文件库无限膨胀。

#### 🌐 `POST /webhooks/tracking`

17TRACK 推送。**回调地址必须与 17TRACK 后台「小包跟踪推送 → URL」逐字一致**：`https://lastgrove.com/api/v1/webhooks/tracking`。

验签：

```
sign = SHA256( rawBody + "/" + TRACK17_KEY )      // 注意中间那个斜杠
与请求头 sign（或 x-sign）比对
```

```json
// 请求（由 17TRACK 发送，节选）
{ "event": "TRACKING_UPDATED",
  "data": { "accepted": [ { "number": "1Z999...", "track_info": { "…": "…" } } ] } }
```

```json
// 响应
{ "data": { "received": true, "items": 3, "matched": 2, "updated": 1,
  "orders": [ { "number": "#TG1135", "status": "Delivered", "moved": true } ] } }
```

| 情形 | HTTP | 处理 |
| --- | --- | --- |
| 正确签名 | 200 | 逐条 `normalize` → `apply`，**内容无变化则不写库**（幂等靠全量快照比对） |
| 验签失败 | 400 | 密钥不一致，或不是 17TRACK 发的；重试无意义 |
| 未配置 `TRACK17_KEY` | 503 | 明确告诉对方"别推了"，好过假装收下再默默丢掉 |
| 非 `TRACKING_UPDATED` 事件 | 200 | `ignored:true`，避免无限重投 |
| 未匹配到订单 | 200 | `matched` 小于 `items`，记日志 |
| 轨迹含 `Delivered` | 200 | 订单 `fulfilled → completed` |

> **必须返回 200**：17TRACK 对非 200 会重试 3 次后放弃本次变更推送。返回 4xx/5xx 的后果是轨迹永久丢失，而且对方后台显示"推送成功"。

---

### 5.15 销售税（v1.4 新增）

美国销售税是 **destination-based**（按收货州），且只有在某州达到 economic nexus 门槛后才有代收义务。所以本站的做法不是"全州都收"，而是 **只对后台配了税率的州收**：没配 = 这个州不注册 = 一分不收。这个取向是刻意选的 —— 多收一笔税要退款、要修正申报，比少收（可后补申报）麻烦十倍。

#### 🔒 `PATCH /admin/settings` 的 `tax` 字段

```json
{
  "tax": {
    "enabled": true,
    "shipTaxable": true,
    "note": "已在 CA / NY 注册",
    "rates": { "California": "7.25", "NY": 8 }
  }
}
```

| 规则 | 说明 |
| --- | --- |
| 州名归一化 | `California` / `CA` / `calif` / `Brooklyn, New York` 都能识别；**不是**简单取前两位（`New York` 取前两位会变成 `NE` = Nebraska，收错州） |
| 百分数自动换算 | 填 `7.25` 存 `0.0725`；填 `0.0725` 也认 |
| 上限保护 | 超过 `0.2`（20%）直接拒，通常是百分点当成小数填了 |
| 空值删州 | `{"CA": ""}` = 删掉加州 |
| 未知州拒收 | `ZZ` 返回 `400`，不做"猜一个" |

#### 🔒 `GET /admin/tax/report`

申报汇总。查询参数 `from` / `to`（默认当年 1 月 1 日至今），`format=csv` 直接下载。

```json
{
  "data": {
    "from": "2026-01-01", "to": "2026-11-16",
    "config": { "enabled": true, "rates": { "CA": 0.0725 }, "shipTaxable": true },
    "totals": { "orders": 42, "untaxed": 30, "tax": 128.4, "sales": 1771.03 },
    "byState": [{ "state": "CA", "orders": 12, "sales": 1599.0, "tax": 115.93 }],
    "byMonth": [{ "period": "2026-11", "state": "CA", "orders": 3, "sales": 402, "tax": 29.15 }]
  }
}
```

口径三条（写进注释也写进文档，因为申报数字对不上时全靠这三条追溯）：

1. **排除** `pending_payment` / `cancelled` / `refunded` —— 没收到钱的、退回去的，都不构成应税销售
2. `taxable = total − tax`（`total` 含运费与税，"应税销售额"不含税本身）
3. **部分退款按原额计入**，报税时手工冲减 —— 系统不做逐单冲减，因为各州对"退款后是否调减"的时点要求不同，自动冲减反而容易报错

#### 🔒 `GET /admin/export/tax.csv`

月 × 州明细，末行 `TOTAL`，可直接交给会计。

---

### 5.16 后台 · 员工账号（v1.4 新增）

权限位 `staff:read` / `staff:write`，**只有 owner 默认拥有**，ops 与 support 两档都不含。
在 v1.4 之前，后台加一个人只能改 `db.json`，而且在库里删错一行就等于把自己锁在门外。

#### 🔑 `GET /admin/staff`

```json
{ "data": {
  "staff": [
    { "id": "S001", "email": "owner@lastgrove.com", "name": "Store owner",
      "role": "owner", "status": "active",
      "permissions": ["metrics:read", "…"],
      "createdAt": "2026-11-13T03:50:51.266Z",
      "lastLoginAt": "2026-11-16T01:12:40.551Z" }
  ],
  "me": "S001",
  "roles": [ { "role": "owner", "permissions": ["…"] }, { "role": "ops", "permissions": ["…"] } ],
  "allPermissions": ["metrics:read", "…", "staff:write"],
  "minPassword": 8
} }
```

响应里**永远不出现 `salt` / `hash`**。`lastLoginAt` 从审计日志回捞，不是另存的字段——多存一份就多一处会对不上的地方。
`roles` 与 `allPermissions` 一起返回，前端才能做到「换角色时把权限框按预置勾好」，而不是让前端自己抄一份常量。

#### 🔑 `POST /admin/staff`

```json
{ "name": "Wei", "email": "wei@lastgrove.com", "role": "support",
  "password": "至少 8 位", "permissions": ["orders:read", "products:read"] }
```

`permissions` 可省略，省略时按角色预置。传了也会**过滤掉不存在的权限位**（前端传错一个字符串不该造出一个半残账号）。
邮箱唯一且不区分大小写；重复返回 `409 CONFLICT`。

#### 🔑 `PATCH /admin/staff/:id`

可改 `name / role / status / permissions / password`，全部可选。

| 规则 | 行为 |
| --- | --- |
| 改 `role` 且**没传** `permissions` | 权限位按新角色**重置**。不重置会出现「角色降了、权限没降」：界面写着 support，一按退款还是能退 |
| 改 `role` 且传了 `permissions` | 以传的为准，非法位过滤 |
| 改 `password` 且改的是**自己** | 必须带 `currentPassword` 并校验通过，否则 `403` |
| 改 `password` 且改的是**别人** | 不校验旧密码（这就是「重置」，旧密码多半已经忘了） |
| 改完密码 | 该账号的**其他会话全部失效**；改自己时保留当前这一条，否则当场被踢出去 |
| 权限变更 | **不需要重新登录**，权限每次请求现读库里 |

#### 🔑 `DELETE /admin/staff/:id`

删账号并清掉其会话。审计日志里该账号的条目**保留**——那是历史事实，不跟着人一起消失。

#### 三条护栏

| 护栏 | 返回 | 为什么 |
| --- | --- | --- |
| 不能停用 / 删除自己 | `409` | 这个后台没有「忘记密码」邮件，删掉自己等于永久失去后台 |
| 不能停用 / 降级 / 删除**最后一个 active owner** | `409` | 没有 owner 之后，设置、退款、加人都没人能改，而且**没有任何界面能救回来** |
| 非 owner 不能创建 owner、不能修改 owner 账号 | `403` | 否则拿到 `staff:write` 的人可以给自己开一个 owner 账号，绕开全部权限位 |

#### owner 恒为全权限（一处刻意的不对称）

`owner` 角色**不读库里那份 permissions 数组**，直接返回 `ALL_PERMISSIONS`。

原因：权限位是数组，可以被单条改写；而 owner 的定义就是「全部权限」。如果只读库里那份，任何一次新增权限位（v1.4 就加了 `staff:read` / `staff:write`）都会让**已经存在**的 owner 账号凭空少两位，然后把自己锁在门外——而且是静默发生的，不会报错。
所以库里那份对 owner 只作记录，不作依据。其他角色仍以库里的数组为准（角色只提供默认值）。

| 失败 code | 说明 |
| --- | --- |
| `BAD_REQUEST` | 邮箱格式、姓名长度、未知角色、密码短于 8 位 |
| `CONFLICT` | 邮箱已存在 / 动了自己 / 动了最后一个 owner |
| `FORBIDDEN` | 缺 `staff:write`，或非 owner 试图操作 owner 账号 |
| `NOT_FOUND` | 账号不存在 |

---

### 5.17 博客（v1.5 新增）

权限位 `posts:write`，ops 与 owner 默认拥有，support 不含——写文章不是客服的活。

**为什么这一版才做接口**：前台是 hash 路由（`/#/products/x`），而 `#` 之后的部分在爬虫眼里根本不属于 URL，
`origin + '/#/products/x'` 与 `origin + '/'` 是同一个地址。博客的收益 100% 来自被搜到，挂在 hash 路由上等于白写。
所以这一版只给博客开了真路径 `/journal`、`/journal/<slug>`（见 SDD §17），其余页面继续走 hash 路由——
不给全站引入 `history.pushState` + `popstate` + 滚动恢复三件套，那三样是 SPA 路由 bug 的主要产地。

页面路由不属于本文件范围，这里只记 8 个 JSON 接口（**5 条路径 / 8 个操作**）。

#### 🔓 `GET /api/v1/posts`

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `section` | 空（全部） | 栏目过滤。**未知栏目返回空列表而不是 400**——栏目是 URL 参数，有人手改地址栏不该看到报错页 |
| `limit` | 9 | 上限 24 |
| `page` | 1 | 超出总页数时**夹到最后一页**，不报错 |

```json
{ "data": [
    { "id": "P1a2b3c", "slug": "why-pvd-is-not-plating", "title": "Why PVD is not plating",
      "excerpt": "…", "section": "materials", "coverImage": "/uploads/…", "coverAlt": "…",
      "publishedAt": "2026-11-02T09:00:00.000Z", "readMinutes": 4 }
  ],
  "meta": { "page": 1, "limit": 9, "total": 3, "pages": 1, "hasMore": false,
            "sections": ["materials", "studio", "giving", "care"] } }
```

列表**不返 `blocks`**。一篇正文 30 KB，乘 9 就是 270 KB，而列表页一个字的正文都不显示。要正文就点进去。
`meta.sections` 一并返回，前台栏目胶囊条才能不写死常量。

#### 🔓 `GET /api/v1/posts/:slug`

返回单篇，含 `blocks`。**草稿与不存在的文章返回完全同形的 404**：

```json
{ "error": { "code": "POST_NOT_FOUND", "message": "Article not found." } }
```

区分开「草稿」与「不存在」等于承认「这里有一篇还没写完的文章」，等于把未发布内容的存在性暴露出去。

#### 🔑 `GET /admin/posts`

参数 `status`（`draft` / `published`，省略为全部）、`limit`（默认 50，上限 100）、`page`。
按 `updatedAt` 倒序——运营找的是「我刚才改的那篇」，不是「最早写的那篇」。
列表里每篇用 `blockCount` 代替 `blocks`，只给数量不给正文。

#### 🔑 `GET /admin/posts/:id`

单篇全量，含 `blocks`。

#### 🔑 `GET /admin/post-meta`

编辑器需要的枚举值一次拿全：

```json
{ "data": { "sections": ["materials", "studio", "giving", "care"],
            "blockTypes": ["p", "h2", "h3", "quote", "ul", "image", "hr"],
            "limits": { "MAX_BLOCKS": 120, "MAX_TEXT": 4000, "MAX_ITEMS": 20,
                        "MAX_ITEM": 400, "MAX_ALT": 200 } } }
```

放在服务端而不是让前端自己写死，是因为**校验也在服务端**。两边各抄一份的结果是：
后台允许输入 200 字、保存时报「超限 158 字」，而运营完全不知道该信哪个。

#### 🔑 `POST /admin/posts`

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `title` | ✅ | ≤ 90 字 |
| `slug` | — | 省略则自动生成；显式传时会被 slugify（`café` → `cafe`）后校验 `^[a-z0-9]+(-[a-z0-9]+)*$`，长度 3–80 |
| `excerpt` | — | ≤ 200 字 |
| `seoTitle` | — | ≤ 70 字 |
| `seoDescription` | — | ≤ 158 字。比 `excerpt` 严：搜索引擎一般在 158 字截断，超出的部分是白写的 |
| `section` | — | 省略取第一个栏目；传了必须是 `sections()` 里的值 |
| `coverImage` | — | 允许为空（旧文没有素材），填了必须以 `/uploads/` 开头 |
| `status` | — | `draft`（默认）/ `published` |
| `blocks` | — | 见下方块白名单 |

**slug 冲突自动加后缀**（`-2`、`-3`）而不是抛 409。让运营为了发一篇文章先去想一个不冲突的 URL，
是把系统的活推给人。中文标题 slugify 之后会变成空串，此时回落到 `journal-<时间戳>`，照样能用，他在后台改就是了。

**块白名单**（7 种，未知类型静默丢弃但会触发整体校验）：

| 类型 | 载荷 | 上限 |
| --- | --- | --- |
| `p` / `h2` / `h3` / `quote` | `{ type, text }` | 单块 4000 字 |
| `ul` | `{ type, items: [] }` | 20 项，每项 400 字 |
| `image` | `{ type, src, alt }` | `src` 必须是 `/uploads/` 开头，否则**整块丢弃** |
| `hr` | `{ type }` | — |

整篇上限 120 块。传了非空 `blocks` 却**一块都没活下来**时返回 `400`：
静默存成空文章比报错更糟，运营以为存上了，第二天发现文章是白的。

#### 🔑 `PATCH /admin/posts/:id`

字段同上，全部可选（`partial` 语义）。两条与状态相关的时间规则：

| 动作 | 行为 |
| --- | --- |
| 草稿 → 发布 | 补 `publishedAt`（没发布过才补） |
| 发布 → 草稿 | **保留**原 `publishedAt`。清空的话，改回发布时文章会掉到列表最末，看起来像被删了 |

`readMinutes` 在**写入时**按词 + 中日韩字重算（200 词/分钟），渲染时不再遍历全文。

#### 🔑 `DELETE /admin/posts/:id`

```json
{ "data": { "deleted": true, "id": "P1a2b3c" } }
```

**不做软删除**。博客文章没有「订单」那种留痕必要，删了就是删了；
真要反悔，审计日志里有 `post.delete` 这一条，记着标题与 slug。

#### 三个写操作共同的机制

| 机制 | 说明 |
| --- | --- |
| `store.tx()` 包住 | 单次写操作要么全成、要么全不成 |
| 审计 | `post.create` / `post.update` / `post.delete`，只存 `{ title, slug, status }`。存整份 `blocks` 等于把 `db.json` 复制第二遍，审计日志会先于业务数据膨胀 |
| `postsRev` 递增 | 每次写操作 `meta.postsRev++`，`/journal` 预渲染缓存整表作废。按 slug 精细失效在千级文章量下没有收益，只多一份要对齐的状态 |

| 失败 code | 说明 |
| --- | --- |
| `BAD_REQUEST` | 标题空、字段超长、未知栏目、封面不是站内上传、`blocks` 全部不合法 |
| `NOT_FOUND` / `POST_NOT_FOUND` | 文章不存在；或公开读时文章是草稿 |
| `FORBIDDEN` | 缺 `posts:write` |

---

## 6 数据字典

### 6.1 Product

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 商品编号，如 `TG-101` |
| `handle` | string | URL 短名，唯一 |
| `title` | string | 商品名 |
| `price` | number | 主价（USD） |
| `compareAt` | number \| null | 划线价 |
| `images` | string[] | 图片路径数组，首张为主图 |
| `motif` | string | 题材（`celestial` / `ocean` / `woodland` …） |
| `category` | string | 品类 |
| `badge` | string \| null | 角标 |
| `rating` | number | 平均评分 |
| `reviewCount` | int | 评价数 |
| `sizes` | string[] | 可选尺寸 |
| `collections` | string[] | 所属集合 handle 列表 |
| `inStock` | boolean | 是否任一变体有货 |
| `totalStock` | int | 全部变体库存合计 |
| `variants` | Variant[] | 变体列表 |

**Variant**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `sku` | string | SKU，唯一 |
| `metal` | string | `Gold` / `Silver` |
| `price` | number | 变体价（可按金属有溢价） |
| `inStock` | boolean | 是否有货 |
| `stock` | int | 精确库存（前端显示"仅剩 N 件"用） |

### 6.2 Order

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `number` | string | 单号，形如 `#TG1131`，全局唯一 |
| `email` | string | 下单邮箱，**已 trim + 小写** |
| `name` | string | 收件人姓名 |
| `status` | string | 见状态机 |
| `items` | OrderItem[] | 明细，**含 0 元赠品行** |
| `subtotal` / `discount` / `shipping` / `total` | number | 金额构成 |
| `couponCode` | string | 使用的券，无则空串 |
| `gift` | object \| null | 赠品快照 |
| `payment` | object | 支付信息（`provider` / `mode` / `reference` / `intent` / `capturedAt` / `last4`）。**`reference` 是通道会话 id（PayPal order id），`intent` 是 capture id**——两者不通用，退款必须用 `intent` |
| `quoteId` | string | 成交时使用的报价 ID |
| `tracking` / `carrier` | string | 运单号 / 承运商。承运商取值见 §5.7 白名单；**不存在自动生成的假单号**（v1.3 起） |
| `trackingState` | object | 物流追踪状态，见下表。无运单号时不存在 |
| `mail` | object | 发信去重标记：`{ confirmedAt, shippedAt, refundedAt }`。**写在同一事务里**，防止并发下重复发信 |
| `paidAt` / `refundedAt` / `cancelledAt` | string | 时间戳 |

**trackingState**（v1.3 新增）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `registeredFor` | string | 已向 17TRACK 订阅的单号。**防重复计费的唯一依据**，单号变了才重新订 |
| `status` | string | 承运商侧状态（`InTransit` / `Delivered` / …） |
| `label` | string | 面向用户的描述文案 |
| `events[]` | array | `{ time, status, location, description }`，**最多 20 条** |
| `lastScanAt` | string | 上次扫描时间 |
| `syncedAt` | string | 上次同步时间 |
| `degraded` | string \| null | 降级原因（如 `-18019823` USPS 政策限制）。非空时前台改文案，不显示空轨迹区 |

**OrderItem**：`productId`、`title`、`variant`（金属）、`size`、`unitPrice`、`qty`、`isGift?`。

> `title` / `unitPrice` 是**下单瞬间的快照**。之后商品改名或调价，历史订单金额与名称都不会变。

### 6.3 StockLedgerEntry

`id`、`sku`、`productId`、`delta`（正负）、`reason`、`refType`、`refId`、`balanceAfter`、`createdAt`。

**硬判据**：任一 SKU 最后一条流水的 `balanceAfter` 必须等于该 SKU 当前库存。

### 6.4 Post

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | `P` + base36 时间戳 + 2 位随机，如 `P1a2b3cxy` |
| `slug` | string | URL 段，全站唯一，`^[a-z0-9]+(-[a-z0-9]+)*$`，3–80 字 |
| `title` | string | ≤ 90 字 |
| `excerpt` | string | ≤ 200 字，列表与 OG 描述共用 |
| `section` | string | 取值来自 `settings.postSections`，默认 `materials` |
| `coverImage` | string | 站内上传路径或空串 |
| `coverAlt` | string | ≤ 200 字 |
| `status` | enum | `draft` / `published` |
| `publishedAt` | ISO string \| null | 首次发布时写入；**改回草稿不清空** |
| `updatedAt` | ISO string | 每次写入更新 |
| `readMinutes` | number | 写入时按词数重算，不由客户端提供 |
| `seoTitle` / `seoDescription` | string | ≤ 70 / ≤ 158 字 |
| `cta` | object \| null | `{ label, href, note }`，正文末尾的引导块 |
| `relatedProduct` | string | 关联商品 handle，空串表示不关联 |
| `blocks` | array | 见 5.17 块白名单；只在详情与后台单篇里出现 |

**硬判据**：任一篇 `status === 'published'` 的文章必须有非空 `publishedAt`；`slug` 全站唯一。

---

## 7 常见集成场景

### 7.1 完整下单时序

```
1. GET  /bootstrap                    ← 首屏：设置 + 导航 + 集合 + 赠品规则
2. GET  /products?collection=…        ← 列表
3. GET  /products/:handle             ← 详情 + 评价
4. POST /cart/validate                ← 加购后校验价格（纠正过期缓存）
5. POST /coupons/validate             ← 点"应用"时即时反馈（可选）
6. POST /checkout/quote               ← 拿 quoteId + 完整金额
7. POST /orders  + Idempotency-Key    ← 下单（带 quoteId）
8. GET  /orders/lookup                ← 事后查单
```

### 7.2 运营改价后前台怎么变

```
后台 PATCH /admin/settings { freeShip: 88 }
        → db.settings.freeShip 改变
        → 下一次 POST /checkout/quote 就用新门槛算运费
        → 前台刷新时 GET /bootstrap 拿到新值，进度条文案跟着变
```

不需要重启、不需要清缓存、不需要重新发布。这是「前后台共用同一份数据」的要求。

### 7.3 对账怎么做

```bash
# 1. 拉全部 SKU 的当前库存
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4600/api/v1/admin/inventory

# 2. 拉库存流水
curl -H "Authorization: Bearer $TOKEN" \
  'http://localhost:4600/api/v1/admin/stock-ledger?limit=200'

# 3. 逐个 SKU 比对「最后一条流水的 balanceAfter」与「当前库存」
#    不一致 → 有库存变动绕过了流水入口 → 当缺陷处理
```

---

## 8 已知限制

| 限制 | 影响 | 计划 |
| --- | --- | --- |
| 限流按单机内存计数 | 多实例部署时退化为「每实例各自计数」 | 上生产前换 Redis 或网关限流 |
| 支付为模拟模式（`mode: "simulated"`） | 未接真实 Stripe，不产生真实扣款 | 等 Stripe 密钥到位后接 Embedded Checkout |
| 未发邮件 | 下单、发货、退款的通知邮件暂未接入 | 等 Resend 域名验证完成 |
| 未接物流 API | 运单号靠人工填写，无自动轨迹回传 | 等物流商接口凭证到位 |
| 数据存单文件 JSON | 并发写入靠内存锁，多进程不安全 | 上生产前迁 PostgreSQL（SDD 方案 A） |
| 无图片上传接口 | 商品图需预先放到静态目录 | 等对象存储开通 |
| 内容页正文不可通过接口编辑 | A-08 只覆盖首页文案与页面标题/导语，正文在 `pages.js` | 下一版做带预览与版本对比的富文本，否则改坏无法回滚 |
| 定制需求单不做自动报价 | 报价由人填写，接口不测算工时与材料 | 有意为之：定制件 SKU 不固定，自动报价会给出错价 |

---

## 9 变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v1.0 | 2026-11-13 | 首次成文。覆盖 38 个操作（36 条路径），对应 `app/server` 当前实现；同步 FRD v2.5 的 7 处业务逻辑修正与 SDD v2.3 第 16 节的 8 条服务端契约 |
| v1.1 | 2026-11-13 | 补 9 个操作（42 路径 / 47 操作）：集合 4、内容 2、定制需求单 3。起因是复核后台时发现 FRD 第 48 行要求的集合 / 内容 / 定制需求单三个模块在交付版里根本没有，接口层同样缺失。同时修正 `bootstrap` 增加 `pages` 与 `bestSellersEyebrow` 两个字段；`PATCH /admin/products/:id` 支持 `collections` 数组（挂载集合） |
| v1.2 | 2026-11-14 | 补 9 个操作（48 路径 / 56 操作）：`POST /admin/products`（新建，默认草稿）、`GET /admin/products/:id`、`POST /admin/products/:id/duplicate`、`DELETE /admin/products/:id`、`POST /admin/uploads`、CSV 导入三件套（preview / import / template）、公开的 `GET /uploads/:file`。`PATCH` 字段面从 8 个扩到 16 个（新增 `cat`/`motif`/`set`/`sizes`/`images`/`variants`/`details`/`handle`）。**权限收紧**：`cost` 从此只对 `role=owner` 返回，ops 的列表、详情、写返回、报错文案四处都做了脱敏。起因：后台 `Products` 页只有 `Price` 和 `Unlist` 两个按钮，100 款 SKU 无法录入 |
| v1.3 | 2026-11-15 | 补 7 个操作（58 路径 / 67 操作）：`GET /payments/methods`、`POST /payments/capture`、`POST /payments/webhook/:provider`、`POST /webhooks/tracking`、`POST /admin/orders/:n/tracking/refresh`、`GET /admin/tracking/quota`、`GET /admin/tracking/health`。新增 §5.14 Webhook 专节；`POST /admin/orders/:n/tracking` 扩展为「保存即订阅 + 发发货信 + 承运商白名单」；Order 数据字典补 `trackingState` 与 `mail` 两个字段。同时补记 `quote` 无税额字段这一能力缺失。起因：文档写着 Stripe、写着「物流未接承运商 API」，而实际跑的是 PayPal + 17TRACK |
| v1.4 | 2026-11-16 | 补 8 个操作（62 路径 / 73 操作）。**员工账号**：`GET/POST /admin/staff`、`PATCH/DELETE /admin/staff/:id`，新增 `staff:read` / `staff:write` 权限位（仅 owner 默认拥有），owner 角色恒为全权限；三条护栏（动自己 / 最后一个 owner / 非 owner 造 owner）写在接口层。**销售税**：`GET /admin/tax/report`、`GET /admin/export/tax.csv`，以及 `POST /checkout/quote` 的 `state` 入参、`PATCH /admin/settings` 的 `tax` 字段；新增 §5.15 销售税专节。**退款接口支持按行部分退款**：`items[]` 指定退哪几件，折扣与税按行分摊，退最后一件时补退运费，响应增加 `refundedTotal` / `fullyRefunded`；订单行补 `sku` 字段。**行为变更**：`POST /orders` 不再沿用报价里的税额，改为按订单收货地址的州重算，不一致即 `PRICE_CHANGED` —— 宁可让用户重看一眼金额，也不"按报价收钱、按新地址记账"。`orders.csv` 增 `Tax` / `Tax state` 两列。起因：FRD §13 P-01 是唯一一项「不解决就不能开门收钱」的代码缺口，而它同时是**收错了要退款、要修正申报**的那类错误，所以宁可少收也不多收（未配置的州一律不收）；P-06 部分退款则是"多件订单退一件会把整单的钱退回去"，直接亏钱 |
| v1.5 | 2026-11-16 | 补 8 个操作（67 路径 / 81 操作）。**博客**：公开 `GET /posts`、`GET /posts/:slug`；后台 `GET /admin/posts`、`GET /admin/posts/:id`、`GET /admin/post-meta`、`POST /admin/posts`、`PATCH /admin/posts/:id`、`DELETE /admin/posts/:id`；新增 `posts:write` 权限位（owner 与 ops 有，support 无）。新增 §5.17 博客专节、§6.4 Post 数据字典；补记 §2.2 权限位表此前漏掉的 `staff:read` / `staff:write` 两行（v1.4 只写进了 §5.16，概览表没跟着改，owner 仍写着「全部 10 项」而实际是 12 项）。**两处刻意的「不说谎」**：草稿对公开接口返回与不存在完全同形的 404；`blocks` 传了非空却一块都没活下来时返回 400 而非静默存成空文章。起因：博客的收益 100% 来自被搜到，而 hash 路由下的 `origin + '/#/x'` 在爬虫眼里等于 `origin + '/'`，sitemap 里那 80 条 `#/` 开头的「URL」是 80 条重复内容 |
| v1.6 | 2026-11-16 | **不新增端点，67 路径 / 81 操作不变**，改四个既有端点的行为。① `PATCH /admin/settings` 新增 `socials`（instagram / pinterest / tiktok），只接受 `http(s)://` 绝对地址，空串表示未配置，非 http(s) 一律 400 并给出 `socials.<key>` 字段级错误——不做「自动补协议」的容错，那是替用户猜，猜出来的链接点过去 404。② `PATCH /admin/settings` 成功时 `meta.postsRev++`，把这个原本属于文章写的失效键扩到设置变更：`/journal` 的页头页脚是预渲染并缓存的，公告条、社交图标、免邮门槛都来自 settings，不作废就出现「店主填了 Instagram、博客页看不见」。③ 四个导出端点（orders / tax / products / customers）全部写 `export.<kind>` 审计，`target=csv`、`meta.count` 记行数（tax 记 null），并在写后显式 flush——导出一张客户表就是带走一份带邮箱的名单，是后台里唯一能一次性拿走全部客户资料的动作，此前一条日志都没有。④ `GET /admin/settings`、`GET /bootstrap`、`/journal` 的 `shellData` 三处都带出 `socials`，缺省 `{}` 而非 `undefined`，前台据此决定页脚图标渲不渲染。起因：《站点运营体检与功能增删改清单 v2.0》查出「后台能点的和前台发生的对不上」，其中四处落在接口层，改界面改不动 |

---

— 文档结束 · LG-API-001 v1.6 · 67 路径 / 81 操作 · 与 `openapi.json` 同步维护（**openapi.json 仍为 v1.2 快照，支付、物流、税务、博客与 socials 尚未写入**） —
