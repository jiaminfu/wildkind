/* 生成 openapi.json（OpenAPI 3.0.3）
   为什么要用脚本而不是手写 JSON：端点是与代码一起演进的，
   脚本里端点清单与 app/server 路由一一对应，改接口时改一处即可重新生成。
   用法：node tools/gen-openapi.js */
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = '/api/v1';

/* 公共错误响应：所有端点都可能返回，统一在这里引用，避免每个路径重复几十行 */
const errRef = name => ({ $ref: '#/components/responses/' + name });

const commonErrors = {
  400: { $ref: '#/components/responses/BadRequest' },
  429: { $ref: '#/components/responses/RateLimited' },
  500: { $ref: '#/components/responses/Internal' },
};

const okJson = (schemaRef, description) => ({
  description: description || '成功',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/' + schemaRef } } },
});

const dataOf = ref => ({
  type: 'object',
  properties: { data: { $ref: '#/components/schemas/' + ref } },
  required: ['data'],
});

const pageOf = ref => ({
  type: 'object',
  properties: {
    data: { type: 'array', items: { $ref: '#/components/schemas/' + ref } },
    meta: { $ref: '#/components/schemas/PageMeta' },
  },
  required: ['data', 'meta'],
});

const auth = [{ bearerAuth: [] }];

/* ---------------- 路径 ---------------- */
const paths = {
  /* --- 系统 --- */
  [BASE + '/health']: {
    get: {
      tags: ['系统'], summary: '健康检查', security: [],
      responses: { 200: okJson('Health'), ...commonErrors },
    },
  },
  [BASE + '/bootstrap']: {
    get: {
      tags: ['系统'], summary: '首屏一次性取全（设置 + 导航 + 集合 + 赠品规则）', security: [],
      responses: { 200: okJson('Bootstrap'), ...commonErrors },
    },
  },

  /* --- 目录 --- */
  [BASE + '/products']: {
    get: {
      tags: ['目录'], summary: '商品列表（数组，无分页元信息）', security: [],
      parameters: [
        { name: 'collection', in: 'query', schema: { type: 'string' }, description: '集合 handle' },
        { name: 'metal', in: 'query', schema: { type: 'string', enum: ['Gold', 'Silver'] } },
        { name: 'price', in: 'query', schema: { type: 'string', enum: ['under-70', '70-100', 'over-100'] } },
        { name: 'stock', in: 'query', schema: { type: 'string', enum: ['in'] }, description: '传 in 只看有货' },
        { name: 'motif', in: 'query', schema: { type: 'string' } },
        { name: 'q', in: 'query', schema: { type: 'string' }, description: '匹配标题 / 描述 / 题材 / 集合' },
        { name: 'sort', in: 'query', schema: { type: 'string', enum: ['featured', 'new', 'best', 'price-asc', 'price-desc', 'rating'], default: 'featured' } },
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 48, default: 24 } },
      ],
      responses: {
        200: { description: '成功', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Product' } } }, required: ['data'] } } } },
        ...commonErrors,
      },
    },
  },
  [BASE + '/products/search']: {
    get: {
      tags: ['目录'], summary: '商品列表（带分页 meta）', security: [],
      parameters: [{ $ref: '#/components/parameters/Page' }, { $ref: '#/components/parameters/Limit' }],
      responses: { 200: { description: '成功', content: { 'application/json': { schema: pageOf('Product') } } }, ...commonErrors },
    },
  },
  [BASE + '/products/{handle}']: {
    get: {
      tags: ['目录'], summary: '商品详情（含已审核评价与相关推荐）', security: [],
      parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: okJson('ProductDetail'), 404: errRef('NotFound'), ...commonErrors },
    },
  },
  [BASE + '/collections']: {
    get: {
      tags: ['目录'], summary: '全部可见集合', security: [],
      responses: { 200: { description: '成功', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Collection' } } } } } } }, ...commonErrors },
    },
  },
  [BASE + '/collections/{handle}']: {
    get: {
      tags: ['目录'], summary: '集合详情 + 商品（分页）', security: [],
      parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } }, { $ref: '#/components/parameters/Page' }, { $ref: '#/components/parameters/Limit' }],
      responses: { 200: okJson('CollectionProducts'), 404: errRef('NotFound'), ...commonErrors },
    },
  },
  [BASE + '/search']: {
    get: {
      tags: ['目录'], summary: '轻量搜索', security: [],
      parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'sort', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 48 } }],
      responses: { 200: { description: '成功', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Product' } } } } } } }, ...commonErrors },
    },
  },

  /* --- 结算 --- */
  [BASE + '/cart/validate']: {
    post: {
      tags: ['结算'], summary: '购物车校验（返回服务端价格，前端价格字段被忽略）', security: [],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CartInput' } } } },
      responses: { 200: okJson('CartValidated'), ...commonErrors, 409: errRef('OutOfStock') },
    },
  },
  [BASE + '/coupons/validate']: {
    post: {
      tags: ['结算'], summary: '单独校验优惠码', security: [],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['code', 'items'], properties: { code: { type: 'string' }, items: { $ref: '#/components/schemas/CartItemInputList' } } } } } },
      responses: { 200: okJson('CouponValidated'), 422: errRef('CouponInvalid'), ...commonErrors },
    },
  },
  [BASE + '/checkout/quote']: {
    post: {
      tags: ['结算'], summary: '报价：锁定价格 / 库存 / 运费 / 赠品，返回 15 分钟有效的 quoteId', security: [],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/QuoteInput' } } } },
      responses: {
        200: okJson('Quote'),
        409: errRef('OutOfStock'),
        422: errRef('Unprocessable'),
        ...commonErrors,
      },
    },
  },

  /* --- 订单（访客） --- */
  [BASE + '/orders']: {
    post: {
      tags: ['订单'], summary: '下单（必须带 quoteId；建议带 Idempotency-Key）', security: [],
      parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/OrderInput' } } } },
      responses: {
        201: okJson('OrderCreated'),
        200: okJson('OrderCreated', '幂等重放：返回原订单，replayed = true'),
        400: errRef('BadRequest'),
        409: errRef('OutOfStock'),
        422: errRef('Unprocessable'),
        ...commonErrors,
      },
    },
  },
  [BASE + '/orders/lookup']: {
    get: {
      tags: ['订单'], summary: '访客查单（单号 + 邮箱双因子）', security: [],
      parameters: [
        { name: 'number', in: 'query', required: true, schema: { type: 'string' }, description: '可带或不带 #' },
        { name: 'email', in: 'query', required: true, schema: { type: 'string', format: 'email' } },
      ],
      responses: { 200: okJson('OrderEnvelope'), 400: errRef('BadRequest'), 404: errRef('NotFound'), ...commonErrors },
    },
  },
  [BASE + '/orders/{number}']: {
    get: {
      tags: ['订单'], summary: '按单号查单（邮箱必须匹配）', security: [],
      parameters: [{ name: 'number', in: 'path', required: true, schema: { type: 'string' } }, { name: 'email', in: 'query', required: true, schema: { type: 'string', format: 'email' } }],
      responses: { 200: okJson('OrderEnvelope'), 404: errRef('NotFound'), ...commonErrors },
    },
  },
  [BASE + '/orders/{number}/cancel']: {
    post: {
      tags: ['订单'], summary: '访客自助取消（仅未发货）', security: [],
      parameters: [{ name: 'number', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } } } } },
      responses: { 200: okJson('OrderEnvelope'), 404: errRef('NotFound'), 409: errRef('Conflict'), ...commonErrors },
    },
  },

  /* --- 后台认证 --- */
  [BASE + '/admin/login']: {
    post: {
      tags: ['后台 · 认证'], summary: '登录，返回 12 小时令牌', security: [],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } } } } },
      responses: { 200: okJson('LoginResult'), 401: errRef('Unauthorized'), 429: errRef('RateLimited') },
    },
  },
  [BASE + '/admin/logout']: {
    post: { tags: ['后台 · 认证'], summary: '登出，服务端吊销令牌', security: auth, responses: { 200: okJson('Ok'), 401: errRef('Unauthorized') } },
  },
  [BASE + '/admin/me']: {
    get: { tags: ['后台 · 认证'], summary: '当前登录者与权限位', security: auth, responses: { 200: okJson('MeResult'), 401: errRef('Unauthorized') } },
  },

  /* --- 后台看板 --- */
  [BASE + '/admin/metrics']: {
    get: {
      tags: ['后台 · 看板'], summary: '经营看板', security: auth,
      parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 365, default: 30 } }],
      responses: { 200: okJson('Metrics'), 401: errRef('Unauthorized'), 403: errRef('Forbidden') },
    },
  },

  /* --- 后台订单 --- */
  [BASE + '/admin/orders']: {
    get: {
      tags: ['后台 · 订单'], summary: '订单列表（筛选 + 搜索 + 分页）', security: auth,
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['paid', 'fulfilling', 'fulfilled', 'completed', 'cancelled', 'refunded'] } },
        { name: 'q', in: 'query', schema: { type: 'string' }, description: '匹配单号 / 邮箱 / 姓名' },
        { $ref: '#/components/parameters/Page' },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
      ],
      responses: { 200: { description: '成功', content: { 'application/json': { schema: pageOf('OrderSummary') } } }, 401: errRef('Unauthorized'), 403: errRef('Forbidden') },
    },
  },
  [BASE + '/admin/orders/{number}']: {
    get: {
      tags: ['后台 · 订单'], summary: '订单详情 + allowedTransitions', security: auth,
      parameters: [{ name: 'number', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: okJson('OrderDetail'), 401: errRef('Unauthorized'), 403: errRef('Forbidden'), 404: errRef('NotFound') },
    },
  },
  [BASE + '/admin/orders/{number}/status']: {
    patch: {
      tags: ['后台 · 订单'], summary: '改订单状态（走状态机；refunded 必须走 /refund）', security: auth,
      parameters: [{ name: 'number', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['paid', 'fulfilling', 'fulfilled', 'completed', 'cancelled', 'refunded'] } } } } } },
      responses: { 200: okJson('OrderEnvelope'), 400: errRef('BadRequest'), 401: errRef('Unauthorized'), 403: errRef('Forbidden'), 404: errRef('NotFound'), 409: errRef('Conflict'), 422: errRef('Unprocessable') },
    },
  },
  [BASE + '/admin/orders/{number}/refund']: {
    post: {
      tags: ['后台 · 订单'], summary: '退款（回补库存 + 释放券 + 冲减客户消费）', security: auth,
      parameters: [{ name: 'number', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { restock: { type: 'boolean', default: true }, amount: { type: 'number', description: '省略表示全额' } } } } } },
      responses: { 200: okJson('RefundResult'), 401: errRef('Unauthorized'), 403: errRef('Forbidden'), 404: errRef('NotFound'), 409: errRef('Conflict') },
    },
  },
  [BASE + '/admin/orders/{number}/tracking']: {
    post: {
      tags: ['后台 · 订单'], summary: '填运单号（自动把 paid/fulfilling 推进到 fulfilled）', security: auth,
      parameters: [{ name: 'number', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['tracking'], properties: { tracking: { type: 'string' }, carrier: { type: 'string', default: 'USPS' } } } } } },
      responses: { 200: okJson('OrderEnvelope'), 400: errRef('BadRequest'), 401: errRef('Unauthorized'), 403: errRef('Forbidden'), 404: errRef('NotFound') },
    },
  },

  /* --- 后台商品与库存 --- */
  [BASE + '/admin/products']: {
    get: {
      tags: ['后台 · 商品'], summary: '商品列表（含成本与 version）', security: auth,
      parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }],
      responses: { 200: { description: '成功', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/AdminProduct' } } } } } }, 401: errRef('Unauthorized'), 403: errRef('Forbidden') } },
    },
  },
  [BASE + '/admin/products/{id}']: {
    patch: {
      tags: ['后台 · 商品'], summary: '改商品（乐观锁；改价不得低于成本）', security: auth,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductPatch' } } } },
      responses: { 200: okJson('AdminProductEnvelope'), 400: errRef('BadRequest'), 401: errRef('Unauthorized'), 403: errRef('Forbidden'), 404: errRef('NotFound'), 409: errRef('Conflict'), 422: errRef('Unprocessable') },
    },
  },
  [BASE + '/admin/products/{id}/variants/{sku}/restock']: {
    post: {
      tags: ['后台 · 商品'], summary: '补货（写库存流水）', security: auth,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'sku', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['qty'], properties: { qty: { type: 'integer', minimum: 1 }, reason: { type: 'string', default: 'manual-restock' } } } } } },
      responses: { 200: okJson('RestockResult'), 400: errRef('BadRequest'), 401: errRef('Unauthorized'), 403: errRef('Forbidden'), 404: errRef('NotFound') },
    },
  },
  [BASE + '/admin/inventory']: {
    get: { tags: ['后台 · 商品'], summary: '按 SKU 的库存与风险等级', security: auth, responses: { 200: { description: '成功', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/InventoryRow' } } } } } }, 401: errRef('Unauthorized'), 403: errRef('Forbidden') } } },
  },
  [BASE + '/admin/stock-ledger']: {
    get: {
      tags: ['后台 · 商品'], summary: '库存流水（倒序，只读）', security: auth,
      parameters: [
        { name: 'sku', in: 'query', schema: { type: 'string' } },
        { name: 'productId', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
      ],
      responses: { 200: { description: '成功', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/LedgerEntry' } } } } } }, 401: errRef('Unauthorized'), 403: errRef('Forbidden') } },
    },
  },

  /* --- 后台客户 / 券 / 评价 --- */
  [BASE + '/admin/customers']: {
    get: { tags: ['后台 · 客户'], summary: '客户列表（按累计消费倒序）', security: auth, responses: { 200: { description: '成功', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Customer' } } } } } }, 401: errRef('Unauthorized'), 403: errRef('Forbidden') } } },
  },
  [BASE + '/admin/coupons']: {
    get: { tags: ['后台 · 营销'], summary: '优惠码列表', security: auth, responses: { 200: { description: '成功', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Coupon' } } } } } }, 401: errRef('Unauthorized'), 403: errRef('Forbidden') } } },
    post: {
      tags: ['后台 · 营销'], summary: '新建优惠码（立即在前台生效）', security: auth,
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CouponInput' } } } },
      responses: { 201: okJson('CouponEnvelope'), 400: errRef('BadRequest'), 401: errRef('Unauthorized'), 403: errRef('Forbidden'), 409: errRef('Conflict') },
    },
  },
  [BASE + '/admin/coupons/{code}']: {
    delete: {
      tags: ['后台 · 营销'], summary: '删除优惠码', security: auth,
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: okJson('DeletedResult'), 401: errRef('Unauthorized'), 403: errRef('Forbidden'), 404: errRef('NotFound') },
    },
  },
  [BASE + '/admin/reviews']: {
    get: {
      tags: ['后台 · 评价'], summary: '评价列表', security: auth,
      parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'approved', 'rejected'] } }],
      responses: { 200: { description: '成功', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/AdminReview' } } } } } }, 401: errRef('Unauthorized'), 403: errRef('Forbidden') } },
    },
  },
  [BASE + '/admin/reviews/{id}']: {
    patch: {
      tags: ['后台 · 评价'], summary: '审核评价（只有 approved 会出现在前台）', security: auth,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['pending', 'approved', 'rejected'] } } } } } },
      responses: { 200: okJson('ReviewEnvelope'), 400: errRef('BadRequest'), 401: errRef('Unauthorized'), 403: errRef('Forbidden'), 404: errRef('NotFound') },
    },
  },

  /* --- 后台设置与审计 --- */
  [BASE + '/admin/settings']: {
    get: { tags: ['后台 · 设置'], summary: '读取站点设置', security: auth, responses: { 200: okJson('SettingsEnvelope'), 401: errRef('Unauthorized'), 403: errRef('Forbidden') } },
    patch: {
      tags: ['后台 · 设置'], summary: '改站点设置（立即反映到前台报价与页面）', security: auth,
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SettingsPatch' } } } },
      responses: { 200: okJson('SettingsPatchResult'), 400: errRef('BadRequest'), 401: errRef('Unauthorized'), 403: errRef('Forbidden') },
    },
  },
  [BASE + '/admin/audit-log']: {
    get: { tags: ['后台 · 设置'], summary: '最近 200 条特权操作', security: auth, responses: { 200: { description: '成功', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/AuditEntry' } } } } } }, 401: errRef('Unauthorized'), 403: errRef('Forbidden') } } },
  },

  /* ---------- 集合（A-06） ---------- */
  [BASE + '/admin/collections']: {
    get: {
      tags: ['后台 · 集合'], summary: '集合列表（含现算的商品数）', security: auth,
      responses: { 200: okJson('CollectionList'), 401: errRef('Unauthorized'), 403: errRef('Forbidden') },
    },
    post: {
      tags: ['后台 · 集合'], summary: '新建集合', security: auth,
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CollectionCreate' } } } },
      responses: {
        200: okJson('CollectionEnvelope'), 400: errRef('BadRequest'),
        409: errRef('Conflict'), 401: errRef('Unauthorized'), 403: errRef('Forbidden'),
      },
    },
  },
  [BASE + '/admin/collections/{handle}']: {
    patch: {
      tags: ['后台 · 集合'], summary: '改集合（标题 / 描述 / 导航开关 / 排序）', security: auth,
      parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CollectionPatch' } } } },
      responses: {
        200: okJson('CollectionEnvelope'), 400: errRef('BadRequest'), 404: errRef('NotFound'),
        401: errRef('Unauthorized'), 403: errRef('Forbidden'),
      },
    },
    delete: {
      tags: ['后台 · 集合'], summary: '删集合（集合内还有商品时拒绝）', security: auth,
      parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        200: okJson('DeletedResult', '已删除'),
        409: errRef('Conflict'), 404: errRef('NotFound'), 401: errRef('Unauthorized'), 403: errRef('Forbidden'),
      },
    },
  },

  /* ---------- 内容（A-08） ---------- */
  [BASE + '/admin/content']: {
    get: {
      tags: ['后台 · 内容'], summary: '读取首页文案与内容页标题/导语', security: auth,
      responses: { 200: okJson('ContentDoc'), 401: errRef('Unauthorized'), 403: errRef('Forbidden') },
    },
    patch: {
      tags: ['后台 · 内容'], summary: '改首页文案 / 内容页标题与导语', security: auth,
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ContentPatch' } } } },
      responses: { 200: okJson('ContentDoc'), 400: errRef('BadRequest'), 401: errRef('Unauthorized'), 403: errRef('Forbidden') },
    },
  },

  /* ---------- 定制需求单（A-12） ---------- */
  [BASE + '/custom-requests']: {
    post: {
      tags: ['门店 · 定制'], summary: '提交定制需求（匿名，限流 6 次 / 10 分钟）',
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CustomRequestCreate' } } } },
      responses: {
        201: okJson('CustomRequestReceiptEnvelope', '已受理'),
        400: errRef('BadRequest'), 429: errRef('RateLimited'),
      },
    },
  },
  [BASE + '/admin/custom-requests']: {
    get: {
      tags: ['后台 · 定制'], summary: '定制需求列表（可按状态筛选）', security: auth,
      parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['new', 'quoted', 'ordered', 'closed'] } }],
      responses: { 200: okJson('CustomRequestList'), 401: errRef('Unauthorized'), 403: errRef('Forbidden') },
    },
  },
  [BASE + '/admin/custom-requests/{id}']: {
    patch: {
      tags: ['后台 · 定制'], summary: '改状态 / 填报价与内部备注（状态单向）', security: auth,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CustomRequestPatch' } } } },
      responses: {
        200: okJson('CustomRequestEnvelope'), 404: errRef('NotFound'),
        409: errRef('Conflict'), 401: errRef('Unauthorized'), 403: errRef('Forbidden'),
      },
    },
  },
};

/* ---------------- 组件 ---------------- */
const S = (props, required, extra) => Object.assign({ type: 'object', properties: props, required: required || Object.keys(props) }, extra || {});
const arr = ref => ({ type: 'array', items: { $ref: '#/components/schemas/' + ref } });
const num = { type: 'number' };
const str = { type: 'string' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };

const schemas = {
  /* 信封 */
  Ok: S({}),
  PageMeta: S({ page: int, limit: int, total: int, hasMore: bool }),
  ErrorBody: S({
    error: S({ code: str, message: str, details: { type: 'array', items: { type: 'object' } } }),
  }),

  Health: S({ status: str, version: str, products: int, orders: int, time: { type: 'string', format: 'date-time' } }),

  Setting: S({
    brand: str, tagline: str, currency: str,
    freeShippingThreshold: num, standardShipping: num, expressShipping: num,
    giftThreshold: { type: 'number', nullable: true }, giftName: { type: 'string', nullable: true },
    announce: str, heroEyebrow: str, heroTitle: str, heroBody: str,
    storeOpen: bool, returnWindowDays: int,
  }),
  Collection: S({ handle: str, title: str, level: int, parent: { type: 'string', nullable: true }, nav: bool, visible: bool, order: int,
    intro: str, count: int, desc: str,
    productCount: int,   // 后台视图现算：挂在该 handle 上的商品数，不落库
  }),
  GiftRule: S({ threshold: num, name: str, value: num, sku: str }),
  Bootstrap: S({ settings: { $ref: '#/components/schemas/Setting' }, collections: arr('Collection'), nav: arr('Collection'), giftRule: { $ref: '#/components/schemas/GiftRule' } }),

  /* 商品 */
  Variant: S({ sku: str, metal: str, price: num, inStock: bool, stock: int }),
  Product: S({
    id: str, handle: str, title: str, price: num,
    compareAt: { type: 'number', nullable: true }, currency: str,
    images: { type: 'array', items: str },
    motif: str, set: str, category: str, badge: { type: 'string', nullable: true },
    rating: num, reviewCount: int, description: str,
    details: { type: 'object' }, sizes: { type: 'array', items: str },
    collections: { type: 'array', items: str },
    inStock: bool, totalStock: int,
    variants: arr('Variant'),
    createdAt: { type: 'string', nullable: true },
  }),
  AdminProduct: S({
    id: str, title: str, handle: str, price: num, cost: num, stock: int,
    active: bool, version: int, variants: arr('Variant'),
  }),
  AdminProductEnvelope: S({ data: S({ product: { $ref: '#/components/schemas/AdminProduct' } }) }),
  ProductPatch: S({
    price: num, compareAt: { type: 'number', nullable: true }, cost: num,
    active: bool, badge: { type: 'string', nullable: true },
    title: str, desc: str, version: int,
  }, []),
  Review: S({ id: str, name: str, rating: int, title: str, body: str, createdAt: str, verified: bool }),
  RelatedItem: S({ id: str, handle: str, title: str, price: num, image: str }),
  ProductDetail: S({ product: { $ref: '#/components/schemas/Product' }, reviews: arr('Review'), related: arr('RelatedItem') }),
  CollectionProducts: S({ data: arr('Product'), meta: S({ collection: { $ref: '#/components/schemas/Collection' }, page: int, limit: int, total: int, hasMore: bool }) }),

  /* 购物车 / 报价 */
  CartItemInput: S({ productId: str, metal: str, size: str, qty: int }),
  CartItemInputList: { type: 'array', maxItems: 30, items: { $ref: '#/components/schemas/CartItemInput' } },
  CartInput: S({ items: { $ref: '#/components/schemas/CartItemInputList' } }),
  CartLine: S({ productId: str, handle: str, title: str, metal: str, size: str, qty: int, unitPrice: num, lineTotal: num, stock: int }),
  CartValidated: S({ data: S({ lines: arr('CartLine'), subtotal: num, currency: str }) }),
  CouponValidated: S({ data: S({ code: str, type: str, value: num, discount: num, subtotal: num, afterDiscount: num }) }),
  QuoteInput: S({
    items: { $ref: '#/components/schemas/CartItemInputList' },
    couponCode: str,
    shippingMethod: { type: 'string', enum: ['Standard', 'Express'], default: 'Standard' },
  }, ['items']),
  GiftLine: S({ productId: str, sku: str, title: str, metal: str, qty: int, isGift: { type: 'boolean', enum: [true] }, image: str }),
  QuoteLine: S({ productId: str, title: str, metal: str, size: str, qty: int, unitPrice: num, lineTotal: num }),
  Quote: S({
    data: S({
      quoteId: str, expiresAt: { type: 'string', format: 'date-time' },
      lines: arr('QuoteLine'), gift: { allOf: [{ $ref: '#/components/schemas/GiftLine' }], nullable: true },
      subtotal: num, discount: num, shipping: num, total: num,
      shippingMethod: str, couponCode: str,
      freeShipGap: num, giftGap: num, currency: str, dutiesIncluded: bool,
    }),
  }),

  /* 订单 */
  OrderItem: S({ productId: str, title: str, variant: str, size: str, unitPrice: num, qty: int, isGift: bool }, undefined, { }),
  Address: S({ line1: str, line2: str, city: str, state: str, zip: str, country: str }, ['line1', 'city', 'state', 'zip', 'country']),
  Payment: S({ provider: str, mode: str, reference: str, last4: str }),
  Order: S({
    number: str, email: str, name: str, status: str, statusLabel: str,
    channel: str, orderType: str,
    items: arr('OrderItem'),
    subtotal: num, shipping: num, discount: num, total: num,
    address: { $ref: '#/components/schemas/Address' },
    shippingMethod: str, tracking: str, carrier: str,
    createdAt: { type: 'string', format: 'date-time' },
    note: str, couponCode: str,
    gift: { type: 'object', nullable: true },
    payment: { $ref: '#/components/schemas/Payment' },
    quoteId: str,
  }),
  OrderInput: S({
    quoteId: str, email: { type: 'string', format: 'email' },
    firstName: str, lastName: str,
    address: { $ref: '#/components/schemas/Address' },
    note: str,
    payment: S({ last4: str }, []),
  }, ['quoteId', 'email', 'firstName', 'lastName', 'address']),
  OrderCreated: S({ data: S({ order: { $ref: '#/components/schemas/Order' }, replayed: bool }) }),
  OrderEnvelope: S({ data: S({ order: { $ref: '#/components/schemas/Order' } }) }),
  OrderSummary: S({ number: str, email: str, name: str, status: str, statusLabel: str, total: num, items: int, createdAt: str, shippingMethod: str }),
  OrderDetail: S({ data: S({ order: { $ref: '#/components/schemas/Order' }, allowedTransitions: { type: 'array', items: str } }) }),
  RefundResult: S({ data: S({ order: { $ref: '#/components/schemas/Order' }, refunded: num, restocked: bool }) }),

  /* 后台 */
  Staff: S({ id: str, email: str, name: str, role: str, permissions: { type: 'array', items: str } }),
  LoginResult: S({ data: S({ token: str, expiresAt: { type: 'string', format: 'date-time' }, staff: { $ref: '#/components/schemas/Staff' } }) }),
  MeResult: S({ data: S({ staff: { $ref: '#/components/schemas/Staff' } }) }),
  SeriesPoint: S({ date: str, revenue: num }),
  TopProduct: S({ title: str, units: int, revenue: num }),
  LowStockRow: S({ sku: str, title: str, metal: str, stock: int }),
  Metrics: S({ data: S({
    window: int, gmv: num, orders: int, units: int, aov: num, refundRate: num,
    gmvDelta: { type: 'number', nullable: true },
    series: arr('SeriesPoint'), topProducts: arr('TopProduct'), lowStock: arr('LowStockRow'),
    pendingReviews: int, awaitingShipment: int,
  }) }),
  InventoryRow: S({ productId: str, title: str, sku: str, metal: str, stock: int, price: num, risk: { type: 'string', enum: ['out', 'reorder', 'healthy'] }, weeksOfCover: { type: 'number', nullable: true } }),
  LedgerEntry: S({
    id: str, sku: str, productId: str, delta: int,
    reason: { type: 'string', enum: ['seed', 'sale', 'refund', 'cancelled', 'restock', 'purchase-order'] },
    refType: { type: 'string', nullable: true }, refId: { type: 'string', nullable: true },
    balanceAfter: int, createdAt: { type: 'string', format: 'date-time' },
  }),
  RestockResult: S({ data: S({ productId: str, sku: str, stock: int, ledgerId: str }) }, []),
  Customer: S({ id: str, email: str, name: str, orders: int, spent: num, tier: { type: 'string', enum: ['New', 'Repeat', 'VIP'] }, last: { type: 'string', nullable: true } }),
  Coupon: S({
    code: str, type: { type: 'string', enum: ['percent', 'fixed'] }, value: num,
    minSubtotal: num, used: int, limit: { type: 'integer', nullable: true },
    startsAt: { type: 'string', nullable: true }, endsAt: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['active', 'scheduled', 'expired', 'inactive'] }, note: str,
  }),
  CouponInput: S({
    code: str, type: { type: 'string', enum: ['percent', 'fixed'], default: 'percent' },
    value: num, minSubtotal: num, limit: { type: 'integer', nullable: true },
    startsAt: { type: 'string', nullable: true }, endsAt: { type: 'string', nullable: true }, note: str,
  }, ['code', 'value']),
  CouponEnvelope: S({ data: { $ref: '#/components/schemas/Coupon' } }),
  AdminReview: S({
    id: str, productId: str, productTitle: str, name: str, rating: int,
    title: str, body: str, createdAt: str,
    status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
    verified: bool, moderatedAt: { type: 'string', nullable: true },
  }),
  ReviewEnvelope: S({ data: S({ review: { $ref: '#/components/schemas/AdminReview' } }) }),
  SettingsPayload: S({
    brand: str, currency: str, freeShip: num, standardShip: num, expressShip: num,
    giftThreshold: { type: 'number', nullable: true }, lowStockThreshold: int,
    returnWindowDays: int, storeOpen: bool, content: { type: 'object' },
  }),
  SettingsEnvelope: S({ data: { $ref: '#/components/schemas/SettingsPayload' } }),
  SettingsPatch: S({
    freeShip: num, standardShip: num, expressShip: num, giftThreshold: num,
    lowStockThreshold: int, returnWindowDays: int, storeOpen: bool, content: { type: 'object' },
  }, []),
  SettingsPatchResult: S({ data: S({ settings: { $ref: '#/components/schemas/SettingsPayload' }, giftRule: { $ref: '#/components/schemas/GiftRule' } }) }),
  AuditEntry: S({
    id: str, at: { type: 'string', format: 'date-time' },
    staffId: str, email: str, action: str, target: { type: 'string', nullable: true },
    meta: { type: 'object', nullable: true }, ip: { type: 'string', nullable: true },
  }),
  DeletedResult: S({ data: S({ deleted: str }) }),

  /* ---------- 集合（A-06） ---------- */
  CollectionList: S({ data: arr('Collection') }),
  CollectionEnvelope: S({ data: S({ collection: { $ref: '#/components/schemas/Collection' } }) }),
  CollectionCreate: S({
    title: str, handle: { type: 'string', description: '留空则从标题推导' },
    desc: str, nav: bool, order: { type: 'integer' }, level: { type: 'integer' },
    parent: { type: 'string', nullable: true }, menuGroup: { type: 'string', nullable: true },
  }, ['title']),
  CollectionPatch: S({
    title: str, desc: str, nav: bool, order: { type: 'integer' },
    menuGroup: { type: 'string', nullable: true },
  }),

  /* ---------- 内容（A-08） ---------- */
  PageDoc: S({
    slug: str, title: str,
    intro: { type: 'string', description: '导语。正文段落仍在 pages.js，不在本接口的可编辑范围' },
  }),
  ContentDoc: S({
    brand: str, tagline: str,
    content: S({
      announce: str, heroEyebrow: str, heroTitle: str,
      heroBody: str, bestSellersEyebrow: str,
    }),
    pages: { type: 'object', additionalProperties: { $ref: '#/components/schemas/PageDoc' } },
  }),
  ContentPatch: S({
    brand: str, tagline: str,
    content: S({ announce: str, heroEyebrow: str, heroTitle: str, heroBody: str, bestSellersEyebrow: str }),
    pages: { type: 'object', additionalProperties: S({ title: str, intro: str }) },
  }),

  /* ---------- 定制需求单（A-12） ---------- */
  CustomRequest: S({
    id: str, name: str, email: str, style: str,
    qty: { type: 'integer' }, dueDate: { type: 'string', nullable: true },
    notes: str, refUrls: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['new', 'quoted', 'ordered', 'closed'] },
    note: { type: 'string', nullable: true }, quote: { type: 'number', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  }),
  CustomRequestCreate: S({
    email: { type: 'string', format: 'email' },
    name: str, style: str,
    qty: { type: 'integer', minimum: 1, maximum: 500 },
    dueDate: { type: 'string', nullable: true },
    notes: { type: 'string', minLength: 10 },
    refUrls: { type: 'array', maxItems: 5, items: { type: 'string', format: 'uri' } },
  }, ['email', 'notes']),
  CustomRequestReceipt: S({
    id: str, status: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' },
  }),
  CustomRequestList: S({ data: arr('CustomRequest') }),
  CustomRequestEnvelope: S({ data: S({ request: { $ref: '#/components/schemas/CustomRequest' } }) }),
  CustomRequestReceiptEnvelope: S({ data: S({ request: { $ref: '#/components/schemas/CustomRequestReceipt' } }) }),
  CustomRequestPatch: S({
    status: { type: 'string', enum: ['quoted', 'ordered', 'closed'], description: '单向流转：new→quoted→ordered→closed' },
    quote: { type: 'number', nullable: true }, note: str,
  }),
};

/* ---------------- 文档 ---------------- */
const doc = {
  openapi: '3.0.3',
  info: {
    title: 'TIDEGLASS API',
    version: '1.0.0',
    description: [
      'TIDEGLASS 跨境饰品独立站接口。',
      '',
      '**响应信封**：成功 `{ "data": … }`；分页 `{ "data": [], "meta": {} }`；失败 `{ "error": { code, message, details } }`。',
      '前端必须按 `code` 分支，不要按 `message` 文案匹配。',
      '',
      '**两个跨接口机制**：',
      '- 报价锁：`POST /checkout/quote` 拿 `quoteId`（15 分钟），下单时必须带上；金额不一致返回 `PRICE_CHANGED`。',
      '- 幂等下单：`POST /orders` 带 `Idempotency-Key` 头，重复提交返回原订单并标记 `replayed: true`。',
      '',
      '**权限**：Bearer Token（12 小时，可吊销），按 10 个权限位鉴权，不按角色判断。',
      '',
      '详细说明见《API 接口文档 v1.0》。',
    ].join('\n'),
    license: { name: 'Proprietary' },
  },
  servers: [{ url: 'http://localhost:4600', description: '本地开发' }],
  tags: [
    { name: '系统', description: '健康检查与首屏聚合' },
    { name: '目录', description: '商品、集合、搜索（公开）' },
    { name: '结算', description: '购物车校验、优惠码、报价（公开）' },
    { name: '订单', description: '下单与访客查单（公开，双因子）' },
    { name: '后台 · 认证', description: '登录 / 登出 / 当前用户' },
    { name: '后台 · 看板', description: '经营指标' },
    { name: '后台 · 订单', description: '订单管理与退款' },
    { name: '后台 · 商品', description: '商品、库存、流水' },
    { name: '后台 · 客户', description: '客户档案' },
    { name: '后台 · 营销', description: '优惠码' },
    { name: '后台 · 评价', description: '评价审核' },
    { name: '后台 · 设置', description: '站点设置与审计日志' },
  ],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', description: '后台登录后拿到的令牌，有效期 12 小时' },
    },
    parameters: {
      Page: { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      Limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 48, default: 24 } },
      IdempotencyKey: { name: 'Idempotency-Key', in: 'header', schema: { type: 'string', format: 'uuid' }, description: '幂等键，同一键重复提交只产生一单' },
    },
    schemas,
    responses: {
      BadRequest: { description: '参数校验失败', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } } },
      Unauthorized: { description: '未登录或令牌失效', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } } },
      Forbidden: { description: '缺少所需权限位', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } } },
      NotFound: { description: '资源不存在', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } } },
      Conflict: { description: '与当前状态冲突', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } } },
      Unprocessable: { description: '业务规则不满足（QUOTE_EXPIRED / PRICE_CHANGED / COUPON_INVALID / INVALID_TRANSITION / STORE_CLOSED / PRICE_BELOW_COST）', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } } },
      OutOfStock: { description: '库存不足，整单拒绝（不部分成交）', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } } },
      CouponInvalid: { description: '优惠码不可用，details.reason 细分原因', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } } },
      RateLimited: { description: '超过限流阈值', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } } },
      Internal: { description: '服务端未预期错误', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } } },
    },
  },
};

const out = path.join(__dirname, '..', 'handover', '04-接口文档', 'openapi.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc, null, 2), 'utf8');

const n = Object.keys(paths).reduce((a, k) => a + Object.keys(paths[k]).length, 0);
console.log('已生成 ' + out);
console.log('  路径 %d 条 · 操作 %d 个 · 组件模型 %d 个', Object.keys(paths).length, n, Object.keys(schemas).length);
