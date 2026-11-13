/* ============================================================
   TIDEGLASS · 后端数据初始化
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
const password = process.env.ADMIN_PASSWORD || 'tideglass2026';

const ownerPw = auth.hashPassword(password);
const opsPw = auth.hashPassword(process.env.OPS_PASSWORD || 'tideglass-ops');

const db = {
  meta: {
    brand: 'TIDEGLASS',
    version: '1.0.0',
    currency: 'USD',
    seededAt: new Date().toISOString(),
    seedSource: 'prototype/assets/js/data.js',
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

  /* ---- 服务端独有 ---- */
  staff: [
    {
      id: 'S001',
      email: 'owner@tideglassjewelry.com',
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
      email: 'ops@tideglassjewelry.com',
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

// 流水由真实订单推导，必须在 products / orders 就位之后再算
db.stockLedger = buildLedger(db);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(db, null, 1), 'utf8');

/* 同时留一份基线快照。自动化测试会改数据（下单、退款、改价），
   没有基线就只能靠「重跑 seed + 重启服务」才能重复跑，测试就不是可重复的了。
   测试开跑前把 SEED_OUT 拷回 db.json 再让服务 reload 即可。 */
const SEED_OUT = path.join(path.dirname(OUT), 'db.seed.json');
fs.writeFileSync(SEED_OUT, JSON.stringify(db, null, 1), 'utf8');

console.log('已生成 ' + OUT);
console.log('       ' + SEED_OUT + '（基线快照，供测试复位）');
console.log('  商品 %d · 集合 %d · 订单 %d · 客户 %d · 优惠码 %d · 评价 %d',
  db.products.length, db.collections.length, db.orders.length,
  db.customers.length, db.coupons.length, db.reviews.length);
console.log('  后台账号：owner@tideglassjewelry.com / %s（owner，全权限）', password);
console.log('            ops@tideglassjewelry.com / %s（ops，无设置权限）', process.env.OPS_PASSWORD || 'tideglass-ops');
console.log('  下一个单号：#TG%d', db.sequences.order);
