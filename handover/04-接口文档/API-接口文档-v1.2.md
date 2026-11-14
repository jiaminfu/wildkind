# TIDEGLASS API 接口文档

| 项 | 内容 |
| --- | --- |
| 文档编号 | TG-API-001 |
| 版本 | v1.2 |
| 编写日期 | 2026-11-14 |
| 对应实现 | `app/server`（Node 原生，零第三方依赖） |
| 对应需求 | FRD v2.7、SDD v2.5 第 16 节「服务端实现契约」、《商品管理补全-需求与设计说明 v1.1》 |
| 端点数量 | 56 个操作，分布在 48 条路径（47 个业务接口 + 1 个公开静态图片；已与实现逐条对账，无遗漏、无虚构） |
| 自动化覆盖 | `tools/api-test.js` 121 例 + `tools/api-test-product.js` 37 例全通过（见《测试报告 v1.3》） |
| 机器可读版 | 同目录 `openapi.json`（OpenAPI 3.0.3，可导入 Postman / Apifox / Swagger UI） |

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
       "couponCode":"TIDEGLASS10","shippingMethod":"Standard"}'

# 后台登录拿令牌
curl -X POST http://localhost:4600/api/v1/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@tideglassjewelry.com","password":"tideglass2026"}'

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
| `orders:read` | `GET /admin/orders`、`GET /admin/orders/:number` |
| `orders:write` | `PATCH /admin/orders/:number/status`、`POST /admin/orders/:number/tracking` |
| `orders:refund` | `POST /admin/orders/:number/refund` |
| `products:read` | `GET /admin/products`、`GET /admin/products/:id`、`GET /admin/inventory`、`GET /admin/stock-ledger`、`GET /admin/reviews` |
| `products:write` | `POST /admin/products`、`PATCH /admin/products/:id`、`DELETE /admin/products/:id`、`POST /admin/products/:id/duplicate`、`POST /admin/uploads`、`POST /admin/products/import/preview`、`POST /admin/products/import`、`GET /admin/products/import/template`、`PATCH /admin/reviews/:id` |
| `inventory:write` | `POST /admin/products/:id/variants/:sku/restock` |
| `customers:read` | `GET /admin/customers` |
| `coupons:write` | `GET /admin/coupons`、`POST /admin/coupons`、`DELETE /admin/coupons/:code` |
| `settings:write` | `GET /admin/settings`、`PATCH /admin/settings`、`GET /admin/audit-log` |

**预置角色：**

| 角色 | 权限位 | 说明 |
| --- | --- | --- |
| `owner` | 全部 10 项 | 店主 |
| `ops` | 除 `settings:write` 外 9 项 | 日常运营，改不了运费/门槛/审计 |
| `support` | `metrics:read` `orders:read` `products:read` `customers:read` | 客服只读 |

> **退款单独一位 `orders:refund`**，不并进 `orders:write`。这是刻意的：能改订单状态和能把钱退出去，风险不是一个量级。

### 2.3 登录与登出

```bash
# 登录
curl -X POST http://localhost:4600/api/v1/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@tideglassjewelry.com","password":"tideglass2026"}'
```

```json
{
  "data": {
    "token": "9f2c…",
    "expiresAt": "2026-11-13T15:18:14.789Z",
    "staff": {
      "id": "S001",
      "email": "owner@tideglassjewelry.com",
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
      "brand": "TIDEGLASS",
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
      "storeOpen": true,
      "returnWindowDays": 30
    },
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
{ "code": "TIDEGLASS10", "items": [ { "productId": "TG-101", "metal": "Gold", "qty": 2 } ] }
```

```json
// 响应
{ "data": { "code": "TIDEGLASS10", "type": "percent", "value": 10,
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
    { "productId": "TG-101", "metal": "Gold", "size": "16\"", "qty": 2 }
  ],
  "couponCode": "TIDEGLASS10",
  "shippingMethod": "Standard"
}
```

`items` 限制：最多 **30 行**，每行最多 **10 件**。

```json
// 响应
{
  "data": {
    "quoteId": "Q3f2a9c1b7e4d8a0f2",
    "expiresAt": "2026-11-13T03:33:14.789Z",
    "lines": [
      { "productId": "TG-101", "title": "Foxtrot Pendant Necklace",
        "metal": "Gold", "size": "16\"", "qty": 2, "unitPrice": 82, "lineTotal": 164 }
    ],
    "gift": {
      "productId": "TG-901", "sku": "TG-901-GO", "title": "Mini Shell Studs",
      "metal": "Gold", "qty": 1, "isGift": true,
      "image": "assets/img/opt/p-earrings-hoop-gold.jpg"
    },
    "subtotal": 164,
    "discount": 16.4,
    "shipping": 0,
    "total": 147.6,
    "shippingMethod": "Standard",
    "couponCode": "TIDEGLASS10",
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
4. 总额 = 小计 − 优惠 + 运费
5. 赠品 = 折后金额达门槛**且赠品有货**时出现，作为 0 元行

`freeShipGap` / `giftGap` 是给"再买 $X 免运费"进度条用的，已按折后金额算好，前端直接用。

| 失败 code | HTTP | 说明 |
| --- | --- | --- |
| `STORE_CLOSED` | 422 | 后台关了接单开关 |
| `OUT_OF_STOCK` | 409 | 某 SKU 不足，`details` 带 `sku / requested / available`。**整单拒绝，不部分成交** |
| `EMPTY_CART` | 400 | `items` 为空 |
| `TOO_MANY_LINES` | 400 | 超过 30 行 |
| `RATE_LIMITED` | 429 | 超过 60 次/分钟 |

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
      "couponCode": "TIDEGLASS10",
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

```json
{ "restock": true, "amount": 147.6 }
```

`restock` 默认 `true`（退货入库）；用户在收到货前退款可选 `false`（货还在路上，不回补）。`amount` 省略表示全额。

```json
{ "data": { "order": { "…": "…" }, "refunded": 147.6, "restocked": true } }
```

一次退款完成四件事：改状态 → 回补库存并写 `refund` 流水 → 释放券 → 冲减客户累计消费与等级。

| 失败 code | 说明 |
| --- | --- |
| `CONFLICT` | 已退款 / 已取消的订单不能退 |
| `FORBIDDEN` | 缺 `orders:refund` 权限位 |

#### 🔑 `POST /admin/orders/:number/tracking`

```json
{ "tracking": "9400 1000 0000 0000 0000 00", "carrier": "USPS" }
```

填写运单号后，若订单处于 `paid` / `fulfilling`，**自动推进到 `fulfilled`**，避免运营忘记改状态导致客户看不到物流。

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

落盘位置 `/app/app/server/data/uploads/`（`tideglass-data` 卷），容器重建不丢。`path` 直接写进商品的 `images` 数组。

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
{ "data": [ { "code": "TIDEGLASS10", "type": "percent", "value": 10,
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
{ "data": { "brand": "TIDEGLASS", "currency": "USD",
            "freeShip": 95, "standardShip": 6.9, "expressShip": 19.9,
            "giftThreshold": 120, "lowStockThreshold": 8, "returnWindowDays": 30,
            "storeOpen": true, "content": { "announce": "…" } } }
```

#### 🔑 `PATCH /admin/settings`

```json
{ "freeShip": 95, "standardShip": 6.9, "expressShip": 19.9,
  "giftThreshold": 120, "lowStockThreshold": 6, "storeOpen": true,
  "content": { "announce": "Black Friday −40%" } }
```

**所有改动立即反映到前台报价与页面**——这是「前后台共用同一份数据」的落点。改完不需要发布、不需要清缓存。

`giftThreshold` 同时写入 `settings` 与 `giftRule`，两处永远一致。

#### 🔑 `GET /admin/audit-log`

最近 200 条特权操作。

```json
{ "data": [ { "id": "Amweedy84", "at": "2026-11-13T03:08:56.836Z",
              "staffId": "S001", "email": "owner@tideglassjewelry.com",
              "action": "order.refund", "target": "#TG1131",
              "meta": { "restock": true, "amount": 147.6 }, "ip": null } ] }
```

`action` 命名规则：`<域>.<动词>`。已实现：`login`、`logout`、`order.status`、`order.refund`、`order.tracking`、`product.update`、`inventory.restock`、`coupon.create`、`coupon.delete`、`review.moderate`、`settings.update`、`collection.create`、`collection.update`、`collection.delete`、`custom.update`、`content.update`。

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
    "brand": "TIDEGLASS", "tagline": "Sea glass doesn't fade.",
    "content": { "announce": "Free shipping over $95 · …", "heroEyebrow": "Sea glass · 316L steel",
                 "heroTitle": "Sea glass doesn't fade.|Neither do we.", "heroBody": "…",
                 "bestSellersEyebrow": "As seen on TikTok" },
    "pages": { "about": { "slug": "about", "title": "Our story", "intro": "…" } }
} }
```

#### 🔑 `PATCH /admin/content`

```json
{ "brand": "TIDEGLASS",
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
| `payment` | object | 支付信息（`provider` / `mode` / `reference` / `last4`） |
| `quoteId` | string | 成交时使用的报价 ID |
| `tracking` / `carrier` | string | 物流信息 |

**OrderItem**：`productId`、`title`、`variant`（金属）、`size`、`unitPrice`、`qty`、`isGift?`。

> `title` / `unitPrice` 是**下单瞬间的快照**。之后商品改名或调价，历史订单金额与名称都不会变。

### 6.3 StockLedgerEntry

`id`、`sku`、`productId`、`delta`（正负）、`reason`、`refType`、`refId`、`balanceAfter`、`createdAt`。

**硬判据**：任一 SKU 最后一条流水的 `balanceAfter` 必须等于该 SKU 当前库存。

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

---

— 文档结束 · TG-API-001 v1.2 · 48 路径 / 56 操作 · 与 `openapi.json` 同步维护 —
