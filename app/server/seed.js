/* ============================================================
   LASTGROVE · 后端数据初始化
   数据源只有一处：prototype/assets/js/data.js（window.SEED）。
   原型与 API 共用同一份商品/订单/客户数据，避免「演示一套、接口另一套」。
   用法：node app/server/seed.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const auth = require('./lib/auth');

const ROOT = path.join(__dirname, '..', '..');
const SEED_FILE = path.join(ROOT, 'prototype', 'assets', 'js', 'data.js');
const OUT = path.join(__dirname, 'data', 'db.json');

function readSeed() {
  const src = fs.readFileSync(SEED_FILE, 'utf8');
  const i = src.indexOf('{');
  const j = src.lastIndexOf('}');
  return JSON.parse(src.slice(i, j + 1));
}

/* --empty：只留功能，不留数据。
   用途是「像刚部署一样」验一遍 —— 空站点会长什么样、运营从零点第一件商品
   要几步、空列表有没有空状态提示。演示数据永远不会暴露这些问题。
   保留的：settings（运费/免邮/店铺开关）、staff（否则没人能登录）、pages（栏目结构）。
   清空的：商品/集合/订单/客户/券/评价/流水/博客/定制需求。 */
const EMPTY = process.argv.indexOf('--empty') >= 0;

function nextSeq(orders) {
  return orders.reduce((max, o) => {
    const m = /(\d+)\s*$/.exec(String(o.number || ''));
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 1040) + 1;
}

/* 库存流水必须与历史订单对得上，否则「流水」只是一张孤立的种子表。
   构造方式：先按订单算出每个 SKU 的真实出入库事件，再把期初余额反推出来，
   使得「期初 + 全部事件 = 当前库存」恒成立。这样后台看到的每一笔扣减都有单据。 */
function buildLedger(d) {
  const byKey = {};
  d.products.forEach(p => (p.variants || []).forEach(v => { byKey[p.id + '|' + v.metal] = v; }));

  const events = {};
  const push = (sku, e) => { (events[sku] = events[sku] || []).push(e); };

  d.orders.forEach(o => {
    if (o.status === 'cancelled') return;   // 未发货即取消：库存已释放，等价于从未出库
    (o.items || []).forEach(it => {
      const v = byKey[it.productId + '|' + it.variant];
      if (!v) return;
      push(v.sku, {
        createdAt: o.createdAt, delta: -Math.abs(it.qty || 1),
        reason: 'sale', refType: 'order', refId: o.number,
      });
      if (o.status === 'refunded') {
        push(v.sku, {
          createdAt: o.refundedAt || o.createdAt, delta: Math.abs(it.qty || 1),
          reason: 'refund', refType: 'order', refId: o.number,
        });
      }
    });
  });

  const rows = [];
  const newId = () => 'L' + crypto.randomBytes(4).toString('hex');

  d.products.forEach(p => (p.variants || []).forEach(v => {
    const evs = (events[v.sku] || []).slice()
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const net = evs.reduce((s, e) => s + e.delta, 0);
    let bal = v.stock - net;                 // 反推期初：保证期末余额等于当前库存
    rows.push({
      id: newId(), sku: v.sku, productId: p.id, delta: bal,
      reason: 'seed', refType: null, refId: null, balanceAfter: bal,
      createdAt: '2026-05-01T00:00:00.000Z',  // 早于任何一张订单
    });
    evs.forEach(e => {
      bal += e.delta;
      rows.push(Object.assign({ id: newId(), sku: v.sku, productId: p.id, balanceAfter: bal }, e));
    });
  }));

  // 时间升序：接口是 slice().reverse() 取最近 50 条，顺序错就会显示成乱序
  rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return rows;
}

const seed = readSeed();
const password = process.env.ADMIN_PASSWORD || 'lastgrove2026';

const ownerPw = auth.hashPassword(password);
const opsPw = auth.hashPassword(process.env.OPS_PASSWORD || 'lastgrove-ops');

const db = {
  meta: {
    brand: 'LASTGROVE',
    version: '1.0.0',
    currency: 'USD',
    seededAt: new Date().toISOString(),
    seedSource: 'prototype/assets/js/data.js',
    /* 预渲染缓存的版本号。缺失时 normalize 会补 1，但补出来的那次不会
       让已缓存的博客页失效 —— 显式写进来，基线本身就带正确起点。 */
    postsRev: 1,
  },
  settings: Object.assign({}, seed.settings, {
    // 后台可改、前台必须跟着变的一组开关
    storeOpen: true,
    giftThreshold: seed.giftRule ? seed.giftRule.threshold : 120,
    returnWindowDays: 30,
    lowStockThreshold: 8,
  }),
  collections: seed.collections.map(c => Object.assign({}, c)),
  products: seed.products.map(p => Object.assign({}, p, {
    // 服务端维护的审计字段
    updatedAt: p.createdAt || new Date().toISOString(),
    version: 1,
  })),
  orders: seed.orders.map(o => Object.assign({
    // 老数据没有这些字段，补齐后报表口径才一致
    refundedAt: o.status === 'refunded' ? o.createdAt : null,
    restockDecision: o.status === 'refunded' ? 'returned' : null,
    orderType: 'sale',
    gift: null,
  }, o)),
  customers: seed.customers,
  coupons: seed.coupons.map(c => Object.assign({
    startsAt: c.startsAt || null,
    endsAt: c.endsAt || null,
  }, c)),
  reviews: seed.reviews,
  giftRule: seed.giftRule,

  /* ---- 内容与服务端独有 ----
     这三项以前不在种子里，靠 store.normalize() 兜底补。后果是基线快照
     db.seed.json 只有 16 个键、运行库有 19 个：测试复位时 copyFileSync 覆盖，
     pages 与 posts 当场回退到出厂默认 —— 运营改过的 11 个内容页文案、
     3 篇博客的标题正文全部静默丢失，而复位接口只返回商品/订单数，看不出来。
     种子里显式写全，基线才是「一个内容完整的干净库」。 */
  pages: JSON.parse(JSON.stringify(require('./lib/pages-default'))),
  posts: JSON.parse(JSON.stringify(require('./lib/posts-default'))),
  customRequests: [],

  /* ---- 服务端独有 ---- */
  staff: [
    {
      id: 'S001',
      email: 'owner@lastgrove.com',
      name: 'Store owner',
      role: 'owner',
      status: 'active',
      permissions: auth.ROLE_PRESETS.owner,
      salt: ownerPw.salt,
      hash: ownerPw.hash,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'S002',
      email: 'ops@lastgrove.com',
      name: 'Operations',
      role: 'ops',
      status: 'active',
      permissions: auth.ROLE_PRESETS.ops,
      salt: opsPw.salt,
      hash: opsPw.hash,
      createdAt: new Date().toISOString(),
    },
  ],
  sessions: [],
  quotes: [],
  idempotency: {},
  stockLedger: [],
  auditLog: [],
  sequences: { order: nextSeq(seed.orders) },
};

/* 空库模式：把演示数据整段拿掉，只留能跑起来的骨架。 */
if (EMPTY) {
  db.collections = [];
  db.products = [];
  db.orders = [];
  db.customers = [];
  db.coupons = [];
  db.reviews = [];
  db.posts = [];
  db.customRequests = [];
  db.stockLedger = [];
  db.auditLog = [];
  db.quotes = [];
  db.sequences = { order: 1001 };
  /* 赠品规则指向的 SKU 已经不存在，留着会让后台显示「满 $120 送某款」但送不出来。
     空库里清掉，运营建好商品后再自己设。 */
  db.giftRule = { threshold: 0, sku: '', name: '', maxPerOrder: 1 };
  db.settings.giftThreshold = 0;
}

// 流水由真实订单推导，必须在 products / orders 就位之后再算
db.stockLedger = buildLedger(db);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(db, null, 1), 'utf8');

/* 同时留一份基线快照。自动化测试会改数据（下单、退款、改价），
   没有基线就只能靠「重跑 seed + 重启服务」才能重复跑，测试就不是可重复的了。
   测试开跑前把 SEED_OUT 拷回 db.json 再让服务 reload 即可。

   --empty 必须写到另一个文件。
   以前两种情况都写 db.seed.json，于是「清空数据做一轮运营模拟」这个动作
   会顺手把 24 件商品的回归基线覆盖成空库 —— 紧接着跑 api-test 就是一片红，
   而且报错看起来像"接口坏了"，不像"基线被自己删了"。两个用途不同，文件就该分开：
     db.seed.json  —— 演示/回归基线（24 商品，断言依赖具体条数）
     db.empty.json —— 空库基线（只有 settings / staff / pages，用于运营模拟） */
const BASELINE = path.join(path.dirname(OUT), EMPTY ? 'db.empty.json' : 'db.seed.json');
fs.writeFileSync(BASELINE, JSON.stringify(db, null, 1), 'utf8');

console.log('已生成 ' + OUT);
console.log('       ' + BASELINE + (EMPTY ? '（空库基线，供运营模拟复位）' : '（回归基线，供测试复位）'));
console.log('  商品 %d · 集合 %d · 订单 %d · 客户 %d · 优惠码 %d · 评价 %d',
  db.products.length, db.collections.length, db.orders.length,
  db.customers.length, db.coupons.length, db.reviews.length);
console.log('  后台账号：owner@lastgrove.com / %s（owner，全权限）', password);
console.log('            ops@lastgrove.com / %s（ops，无设置权限）', process.env.OPS_PASSWORD || 'lastgrove-ops');
console.log('  下一个单号：#LG%d', db.sequences.order);
