/* ============================================================
   TIDEGLASS · 后台接口（全部需要 Bearer 令牌 + 权限位）
   路由前缀 /api/v1/admin/*；每个写操作都写 auditLog。
   ============================================================ */
'use strict';
const store = require('../lib/store');
const auth = require('../lib/auth');
const pricing = require('../lib/pricing');
const { E, ApiError, ok, rateLimit, clientIp } = require('../lib/http');
const { applyRefund } = require('./checkout');

const LIVE = ['paid', 'fulfilling', 'fulfilled', 'completed'];
const STATUS_LABEL = {
  paid: 'Paid', fulfilling: 'Preparing', fulfilled: 'Shipped',
  completed: 'Delivered', refunded: 'Refunded', cancelled: 'Cancelled',
};

function audit(me, action, target, meta) {
  const db = store.get();
  db.auditLog.unshift({
    id: 'A' + Date.now().toString(36),
    at: new Date().toISOString(),
    staffId: me ? me.staffId : null,
    email: me ? me.email : null,
    action, target: target || null, meta: meta || null,
    ip: null,
  });
  if (db.auditLog.length > 2000) db.auditLog.length = 2000;
}

function inRange(o, days) {
  return (Date.now() - new Date(o.createdAt).getTime()) < days * 864e5;
}

function metrics(db, days) {
  const list = db.orders.filter(o => inRange(o, days));
  const live = list.filter(o => LIVE.indexOf(o.status) >= 0);
  const refunded = list.filter(o => o.status === 'refunded');
  const gmv = pricing.round2(live.reduce((a, o) => a + o.total, 0));
  const units = live.reduce((a, o) => a + o.items.reduce((b, i) => b + i.qty, 0), 0);

  const prev = db.orders.filter(o => {
    const age = (Date.now() - new Date(o.createdAt).getTime()) / 864e5;
    return age >= days && age < days * 2 && LIVE.indexOf(o.status) >= 0;
  });
  const prevGmv = pricing.round2(prev.reduce((a, o) => a + o.total, 0));

  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 864e5);
    const key = day.toISOString().slice(0, 10);
    const v = db.orders
      .filter(o => String(o.createdAt).slice(0, 10) === key && LIVE.indexOf(o.status) >= 0)
      .reduce((a, o) => a + o.total, 0);
    series.push({ date: key, revenue: pricing.round2(v) });
  }

  const byProduct = {};
  live.forEach(o => o.items.forEach(i => {
    if (i.isGift) return;
    const k = i.productId;
    byProduct[k] = byProduct[k] || { productId: k, title: i.title, units: 0, revenue: 0 };
    byProduct[k].units += i.qty;
    byProduct[k].revenue = pricing.round2(byProduct[k].revenue + i.unitPrice * i.qty);
  }));
  const topProducts = Object.values(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 6);

  return {
    window: days,
    gmv,
    orders: live.length,
    aov: live.length ? pricing.round2(gmv / live.length) : 0,
    units,
    refundRate: list.length ? Math.round(refunded.length / list.length * 1000) / 10 : 0,
    refundedOrders: refunded.length,
    prevGmv,
    gmvDelta: prevGmv ? Math.round((gmv - prevGmv) / prevGmv * 1000) / 10 : null,
    series,
    topProducts,
  };
}

/* 可改的状态流转：不允许从终态回退，也不允许跳过发货直接送达 */
const TRANSITIONS = {
  paid: ['fulfilling', 'cancelled', 'refunded'],
  fulfilling: ['fulfilled', 'cancelled', 'refunded'],
  fulfilled: ['completed', 'refunded'],
  completed: ['refunded'],
  refunded: [],
  cancelled: [],
};

function routes(router) {
  /* ---------------- 登录 ---------------- */
  router.post('/api/v1/admin/login', (req, res) => {
    rateLimit('login:' + clientIp(req), 10, 5 * 60 * 1000);
    const db = store.get();
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const password = String((req.body || {}).password || '');
    const staff = db.staff.find(s => String(s.email).toLowerCase() === email);
    // 账号不存在也走一次哈希比较，避免用响应时间枚举邮箱
    const okPw = staff
      ? auth.verifyPassword(password, staff.salt, staff.hash)
      : auth.verifyPassword(password, 'decoy', 'decoy');
    if (!staff || !okPw || staff.status !== 'active') {
      throw E.unauthorized('Email or password is incorrect.');
    }
    const token = auth.issueToken(staff.id, clientIp(req));
    audit({ staffId: staff.id, email: staff.email }, 'login', staff.id);
    store.flush();
    ok(res, {
      token,
      staff: {
        id: staff.id, email: staff.email, name: staff.name,
        role: staff.role, permissions: staff.permissions || auth.ROLE_PRESETS[staff.role],
      },
      expiresIn: auth.TOKEN_TTL_MS / 1000,
    });
  });

  router.post('/api/v1/admin/logout', (req, res) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (token) auth.revoke(token);
    ok(res, { signedOut: true });
  });

  router.get('/api/v1/admin/me', (req, res) => {
    const me = auth.requireAuth(req);
    ok(res, { staff: { id: me.staffId, email: me.email, name: me.name, role: me.role, permissions: me.permissions } });
  });

  /* ---------------- 看板 ---------------- */
  router.get('/api/v1/admin/metrics', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'metrics:read');
    const db = store.get();
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const m = metrics(db, days);
    const lowStock = db.products
      .filter(p => p.active)
      .flatMap(p => (p.variants || []).map(v => ({ p, v })))
      .filter(x => x.v.stock <= (db.settings.lowStockThreshold || 8))
      .map(x => ({ sku: x.v.sku, title: x.p.title, metal: x.v.metal, stock: x.v.stock }))
      .sort((a, b) => a.stock - b.stock);
    ok(res, Object.assign(m, {
      lowStock,
      pendingReviews: db.reviews.filter(r => r.status === 'pending').length,
      awaitingShipment: db.orders.filter(o => o.status === 'paid' || o.status === 'fulfilling').length,
    }));
  });

  /* ---------------- 订单 ---------------- */
  router.get('/api/v1/admin/orders', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'orders:read');
    const db = store.get();
    let list = db.orders.slice();
    if (req.query.status) list = list.filter(o => o.status === req.query.status);
    if (req.query.q) {
      const n = String(req.query.q).toLowerCase();
      list = list.filter(o =>
        String(o.number).toLowerCase().includes(n) ||
        String(o.email).toLowerCase().includes(n) ||
        String(o.name).toLowerCase().includes(n));
    }
    const total = list.length;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const items = list.slice((page - 1) * limit, page * limit).map(o => ({
      number: o.number, email: o.email, name: o.name, status: o.status,
      statusLabel: STATUS_LABEL[o.status] || o.status,
      total: o.total, items: (o.items || []).length,
      createdAt: o.createdAt, shippingMethod: o.shippingMethod,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ data: items, meta: { page, limit, total, hasMore: page * limit < total } }));
  });

  router.get('/api/v1/admin/orders/:number', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'orders:read');
    const db = store.get();
    const o = db.orders.find(x => String(x.number).toUpperCase() === String(req.params.number).toUpperCase());
    if (!o) throw E.notFound('Order not found.');
    ok(res, {
      order: o,
      allowedTransitions: TRANSITIONS[o.status] || [],
    });
  });

  router.patch('/api/v1/admin/orders/:number/status', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'orders:write');
    const db = store.get();
    const o = db.orders.find(x => String(x.number).toUpperCase() === String(req.params.number).toUpperCase());
    if (!o) throw E.notFound('Order not found.');
    const to = String((req.body || {}).status || '');
    if (!STATUS_LABEL[to]) throw E.badRequest('Unknown status "' + to + '".');
    if (to === o.status) throw E.conflict('Order is already ' + to + '.');
    const allowed = TRANSITIONS[o.status] || [];
    if (allowed.indexOf(to) < 0) {
      throw E.conflict('Cannot go from ' + o.status + ' to ' + to + '.', { allowedTransitions: allowed });
    }
    // 退款必须走退款接口，不能只改状态——否则库存、券、客户消费都不回滚
    if (to === 'refunded') {
      throw E.unprocessable('USE_REFUND_ENDPOINT',
        'Use POST /api/v1/admin/orders/:number/refund so stock and coupons are restored.');
    }
    o.status = to;
    o.statusLabel = STATUS_LABEL[to];
    if (to === 'fulfilled' && !o.tracking) {
      o.tracking = '9400' + Math.floor(Math.random() * 1e10);
      o.carrier = o.carrier || 'USPS';
    }
    audit(me, 'order.status', o.number, { to });
    store.flush();
    ok(res, { order: o });
  });

  router.post('/api/v1/admin/orders/:number/refund', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'orders:refund');
    const db = store.get();
    const o = db.orders.find(x => String(x.number).toUpperCase() === String(req.params.number).toUpperCase());
    if (!o) throw E.notFound('Order not found.');
    if (o.status === 'refunded') throw E.conflict('Already refunded.');
    if (o.status === 'cancelled') throw E.conflict('Cancelled orders cannot be refunded.');
    const b = req.body || {};
    const out = applyRefund(o, { restock: b.restock !== false, amount: b.amount });
    audit(me, 'order.refund', o.number, { restock: b.restock !== false, amount: out.refundAmount });
    store.flush();
    ok(res, { order: out, refunded: out.refundAmount, restocked: out.restockDecision === 'returned' });
  });

  router.post('/api/v1/admin/orders/:number/tracking', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'orders:write');
    const db = store.get();
    const o = db.orders.find(x => String(x.number).toUpperCase() === String(req.params.number).toUpperCase());
    if (!o) throw E.notFound('Order not found.');
    const b = req.body || {};
    if (!b.tracking) throw E.badRequest('Tracking number is required.', [{ field: 'tracking', message: 'Required.' }]);
    o.tracking = String(b.tracking).slice(0, 64);
    o.carrier = String(b.carrier || 'USPS').slice(0, 32);
    if (o.status === 'paid' || o.status === 'fulfilling') {
      o.status = 'fulfilled';
      o.statusLabel = STATUS_LABEL.fulfilled;
    }
    audit(me, 'order.tracking', o.number, { carrier: o.carrier, tracking: o.tracking });
    store.flush();
    ok(res, { order: o });
  });

  /* ---------------- 商品 ---------------- */
  router.get('/api/v1/admin/products', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:read');
    const db = store.get();
    let list = db.products.slice();
    if (req.query.q) {
      const n = String(req.query.q).toLowerCase();
      list = list.filter(p => (p.title + ' ' + p.id).toLowerCase().includes(n));
    }
    ok(res, list.map(p => ({
      id: p.id, handle: p.handle, title: p.title, price: p.price,
      compareAt: p.compareAt || null, cost: p.cost || 0,
      stock: pricing.totalStock(p), active: !!p.active,
      badge: p.badge || null, category: p.cat,
      variants: (p.variants || []).map(v => ({ sku: v.sku, metal: v.metal, stock: v.stock, price: v.price })),
      updatedAt: p.updatedAt, version: p.version,
    })));
  });

  router.patch('/api/v1/admin/products/:id', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:write');
    const db = store.get();
    const p = pricing.findProduct(db, req.params.id);
    if (!p) throw E.notFound('Product not found.');
    const b = req.body || {};
    const before = { price: p.price, cost: p.cost, active: p.active };

    // 乐观锁：前端带 version，不一致说明别人刚改过
    if (b.version != null && b.version !== p.version) {
      throw E.conflict('This product was changed by someone else. Reload and try again.',
        { currentVersion: p.version });
    }

    if (b.price != null) {
      const np = Number(b.price);
      if (!Number.isFinite(np) || np <= 0) {
        throw E.badRequest('Price must be greater than 0.', [{ field: 'price', message: 'Must be > 0.' }]);
      }
      if (np < (p.cost || 0)) {
        throw E.unprocessable('PRICE_BELOW_COST',
          'Price $' + np.toFixed(2) + ' is below unit cost $' + (p.cost || 0).toFixed(2) + '.');
      }
      // 变体价按原比例跟随，保住 Rose Gold 之类的溢价关系
      const oldPrice = p.price;
      p.price = pricing.round2(np);
      if (oldPrice > 0) {
        (p.variants || []).forEach(v => {
          v.price = pricing.round2(np * (v.price / oldPrice));
        });
      }
    }
    if (b.compareAt != null) p.compareAt = b.compareAt === null ? null : pricing.round2(b.compareAt);
    if (b.cost != null) p.cost = pricing.round2(b.cost);
    if (b.active != null) p.active = !!b.active;
    if (b.badge != null) p.badge = b.badge || null;
    if (b.title != null) p.title = String(b.title).slice(0, 120);
    if (b.desc != null) p.desc = String(b.desc).slice(0, 2000);
    /* 挂载集合：只接受库里真实存在的 handle，别让手滑的拼写产生"看不见的集合" */
    if (Array.isArray(b.collections)) {
      const known = new Set(db.collections.map(c => c.handle));
      p.collections = b.collections.map(String).filter(h => known.has(h));
    }

    p.updatedAt = new Date().toISOString();
    p.version = (p.version || 1) + 1;
    audit(me, 'product.update', p.id, { before, after: { price: p.price, cost: p.cost, active: p.active } });
    store.flush();
    ok(res, { product: p });
  });

  /* 补货：写流水，不只是把数字加上去 */
  router.post('/api/v1/admin/products/:id/variants/:sku/restock', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'inventory:write');
    const db = store.get();
    const p = pricing.findProduct(db, req.params.id);
    if (!p) throw E.notFound('Product not found.');
    const v = (p.variants || []).find(x => x.sku === req.params.sku);
    if (!v) throw E.notFound('SKU not found.');
    const qty = Math.floor(Number((req.body || {}).qty));
    if (!Number.isFinite(qty) || qty === 0) {
      throw E.badRequest('Quantity must be a non-zero integer.', [{ field: 'qty', message: 'Required.' }]);
    }
    v.stock = Math.max(0, v.stock + qty);
    p.stock = (p.variants || []).reduce((a, x) => a + x.stock, 0);
    p.updatedAt = new Date().toISOString();
    db.stockLedger.push({
      id: 'L' + Math.random().toString(36).slice(2, 10),
      sku: v.sku, productId: p.id, delta: qty,
      reason: String((req.body || {}).reason || 'restock'),
      refType: 'manual', refId: me.staffId,
      balanceAfter: v.stock, createdAt: new Date().toISOString(),
    });
    audit(me, 'inventory.restock', v.sku, { qty, balanceAfter: v.stock });
    store.flush();
    ok(res, { sku: v.sku, stock: v.stock, delta: qty });
  });

  router.get('/api/v1/admin/inventory', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:read');
    const db = store.get();
    const threshold = db.settings.lowStockThreshold || 8;
    const rows = [];
    db.products.filter(p => p.active).forEach(p => {
      (p.variants || []).forEach(v => {
        const risk = v.stock === 0 ? 'out' : v.stock <= threshold ? 'reorder' : 'healthy';
        rows.push({
          productId: p.id, title: p.title, sku: v.sku, metal: v.metal,
          stock: v.stock, price: v.price, risk,
          weeksOfCover: p.sold30 ? Math.round(v.stock / Math.max(1, p.sold30 / 4.3) * 10) / 10 : null,
        });
      });
    });
    rows.sort((a, b) => a.stock - b.stock);
    ok(res, rows);
  });

  router.get('/api/v1/admin/stock-ledger', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:read');
    const db = store.get();
    let list = db.stockLedger.slice().reverse();
    if (req.query.sku) list = list.filter(l => l.sku === req.query.sku);
    if (req.query.productId) list = list.filter(l => l.productId === req.query.productId);
    ok(res, list.slice(0, Math.min(200, parseInt(req.query.limit, 10) || 50)));
  });

  /* ---------------- 客户 ---------------- */
  router.get('/api/v1/admin/customers', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'customers:read');
    const db = store.get();
    ok(res, db.customers.slice().sort((a, b) => (b.spent || 0) - (a.spent || 0)).map(c => ({
      id: c.id, email: c.email, name: c.name, orders: c.orders,
      spent: c.spent, tier: c.tier, last: c.last,
    })));
  });

  /* ---------------- 优惠券 ---------------- */
  router.get('/api/v1/admin/coupons', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'coupons:write');
    ok(res, store.get().coupons);
  });

  router.post('/api/v1/admin/coupons', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'coupons:write');
    const db = store.get();
    const b = req.body || {};
    const code = String(b.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,24}$/.test(code)) {
      throw E.badRequest('Code must be 3–24 characters, letters/numbers/-/_ only.',
        [{ field: 'code', message: 'Invalid format.' }]);
    }
    if (db.coupons.some(c => c.code.toUpperCase() === code)) {
      throw E.conflict('That code already exists.');
    }
    const type = b.type === 'fixed' ? 'fixed' : 'percent';
    const value = Number(b.value);
    if (!Number.isFinite(value) || value <= 0) throw E.badRequest('Value must be greater than 0.');
    if (type === 'percent' && value > 100) throw E.badRequest('Percentage cannot exceed 100.');
    const coupon = {
      code, type, value: pricing.round2(value),
      minSubtotal: pricing.round2(Number(b.minSubtotal) || 0),
      used: 0,
      limit: b.limit == null ? null : Math.max(1, parseInt(b.limit, 10)),
      startsAt: b.startsAt || null,
      endsAt: b.endsAt || null,
      status: b.status || 'active',
      note: String(b.note || '').slice(0, 200),
    };
    db.coupons.push(coupon);
    audit(me, 'coupon.create', code);
    store.flush();
    ok(res, coupon, 201);
  });

  router.delete('/api/v1/admin/coupons/:code', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'coupons:write');
    const db = store.get();
    const code = String(req.params.code).toUpperCase();
    const before = db.coupons.length;
    db.coupons = db.coupons.filter(c => c.code.toUpperCase() !== code);
    if (db.coupons.length === before) throw E.notFound('Coupon not found.');
    audit(me, 'coupon.delete', code);
    store.flush();
    ok(res, { deleted: code });
  });

  /* ---------------- 评价 ---------------- */
  router.get('/api/v1/admin/reviews', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:read');
    const db = store.get();
    let list = db.reviews.slice().reverse();
    if (req.query.status) list = list.filter(r => r.status === req.query.status);
    ok(res, list.slice(0, 200));
  });

  router.patch('/api/v1/admin/reviews/:id', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:write');
    const db = store.get();
    const r = db.reviews.find(x => x.id === req.params.id);
    if (!r) throw E.notFound('Review not found.');
    const status = String((req.body || {}).status || '');
    if (['approved', 'rejected', 'pending'].indexOf(status) < 0) {
      throw E.badRequest('Status must be approved, rejected or pending.');
    }
    r.status = status;
    r.moderatedAt = new Date().toISOString();
    r.moderatedBy = me.staffId;
    audit(me, 'review.moderate', r.id, { status });
    store.flush();
    ok(res, { review: r });
  });

  /* ---------------- 设置 ---------------- */
  router.get('/api/v1/admin/settings', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'settings:write');
    const db = store.get();
    const s = db.settings;
    ok(res, {
      brand: s.brand, tagline: s.tagline, currency: s.currency,
      freeShip: s.freeShip, standardShip: s.standardShip, expressShip: s.expressShip,
      giftThreshold: db.giftRule ? db.giftRule.threshold : null,
      lowStockThreshold: s.lowStockThreshold, returnWindowDays: s.returnWindowDays,
      storeOpen: s.storeOpen !== false,
      content: s.content || {},
    });
  });

  router.patch('/api/v1/admin/settings', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'settings:write');
    const db = store.get();
    const b = req.body || {};
    const before = JSON.parse(JSON.stringify({
      freeShip: db.settings.freeShip, standardShip: db.settings.standardShip,
      giftThreshold: db.giftRule ? db.giftRule.threshold : null,
      storeOpen: db.settings.storeOpen,
    }));
    ['freeShip', 'standardShip', 'expressShip', 'lowStockThreshold', 'returnWindowDays'].forEach(k => {
      if (b[k] != null) {
        const n = Number(b[k]);
        if (!Number.isFinite(n) || n < 0) throw E.badRequest(k + ' must be a non-negative number.');
        db.settings[k] = pricing.round2(n);
      }
    });
    if (b.storeOpen != null) db.settings.storeOpen = !!b.storeOpen;
    if (b.giftThreshold != null && db.giftRule) {
      db.giftRule.threshold = pricing.round2(Number(b.giftThreshold));
      db.settings.giftThreshold = db.giftRule.threshold;
    }
    if (b.content && typeof b.content === 'object') {
      db.settings.content = Object.assign({}, db.settings.content, b.content);
    }
    audit(me, 'settings.update', 'store', { before, after: b });
    store.flush();
    ok(res, { settings: db.settings, giftRule: db.giftRule });
  });

  router.get('/api/v1/admin/audit-log', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'settings:write');
    ok(res, store.get().auditLog.slice(0, 200));
  });

  /* ---------------- 集合（A-06 / FR-A-010） ----------------
     集合不是"另建一张表"，它就是商品身上的一个标签数组。
     所以数量永远现算，不存字段——存了就会和商品对不上，
     后台显示 12 件、前台打开只有 10 件，是最难查的那种不一致。 */
  function withCounts(db) {
    const counts = {};
    db.products.forEach(p => {
      (p.collections || []).forEach(h => { counts[h] = (counts[h] || 0) + 1; });
    });
    return db.collections
      .map(c => Object.assign({}, c, { productCount: counts[c.handle] || 0 }))
      .sort((a, b) => (a.level || 1) - (b.level || 1) || (a.order || 0) - (b.order || 0));
  }

  router.get('/api/v1/admin/collections', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:read');
    ok(res, withCounts(store.get()));
  });

  router.post('/api/v1/admin/collections', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:write');
    const db = store.get();
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) throw E.badRequest('Title is required.', [{ field: 'title', message: 'Required.' }]);

    // handle 手填优先，否则从标题推导；两种情况都要保证唯一，否则前台路由会撞
    const handle = String(b.handle || title).trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    if (!handle) throw E.badRequest('Handle is empty after normalising the title.');
    if (db.collections.some(c => c.handle === handle)) {
      throw new ApiError(409, 'COLLECTION_EXISTS',
        'A collection with handle "' + handle + '" already exists.');
    }

    const col = {
      handle, title,
      nav: b.nav !== false,
      level: Number(b.level) || 1,
      parent: b.parent || null,
      menuGroup: b.menuGroup || null,
      order: Number(b.order) || (db.collections.length + 1),
      desc: String(b.desc || '').slice(0, 400),
      count: 0,
    };
    db.collections.push(col);
    audit(me, 'collection.create', handle, { title });
    store.flush();
    ok(res, { collection: col });
  });

  router.patch('/api/v1/admin/collections/:handle', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:write');
    const db = store.get();
    const c = db.collections.find(x => x.handle === req.params.handle);
    if (!c) throw E.notFound('Collection not found.');
    const b = req.body || {};
    const before = { title: c.title, nav: c.nav, order: c.order };

    if (b.title != null) {
      const t = String(b.title).trim();
      if (!t) throw E.badRequest('Title cannot be empty.');
      c.title = t.slice(0, 80);
    }
    if (b.desc != null) c.desc = String(b.desc).slice(0, 400);
    // 导航开关：关掉之后前台顶部菜单立即消失（bootstrap 的 nav 就是按这个过滤的）
    if (b.nav != null) c.nav = !!b.nav;
    if (b.order != null) {
      const n = Number(b.order);
      if (!Number.isFinite(n)) throw E.badRequest('Order must be a number.');
      c.order = n;
    }
    if (b.menuGroup != null) c.menuGroup = b.menuGroup || null;

    audit(me, 'collection.update', c.handle, { before, after: { title: c.title, nav: c.nav, order: c.order } });
    store.flush();
    ok(res, { collection: Object.assign({}, c, {
      productCount: db.products.filter(p => (p.collections || []).indexOf(c.handle) >= 0).length,
    }) });
  });

  router.delete('/api/v1/admin/collections/:handle', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:write');
    const db = store.get();
    const i = db.collections.findIndex(x => x.handle === req.params.handle);
    if (i < 0) throw E.notFound('Collection not found.');
    const inUse = db.products.filter(p => (p.collections || []).indexOf(req.params.handle) >= 0).length;
    /* 有商品挂着就不删：删掉集合，商品会静默从那个入口消失（列表页 404），
       运营很难把两件事联系起来。要求先移空，是刻意的不方便。 */
    if (inUse > 0) {
      throw new ApiError(409, 'COLLECTION_NOT_EMPTY',
        inUse + ' products still sit in this collection. Move them out first.', { products: inUse });
    }
    db.collections.splice(i, 1);
    audit(me, 'collection.delete', req.params.handle, {});
    store.flush();
    ok(res, { deleted: req.params.handle });
  });

  /* ---------------- 定制需求单（A-12 / FR-A-019） ----------------
     前台 FR-S-092 提交 → 这里看到 → 报价 → 成单。状态单向流转，
     和订单一样不允许回退，因为"已报价"之后再退回"待处理"会让运营重报一次。 */
  const CR_FLOW = { new: ['quoted', 'closed'], quoted: ['ordered', 'closed'], ordered: ['closed'], closed: [] };

  router.get('/api/v1/admin/custom-requests', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'orders:read');
    const status = String(req.query.status || '');
    const list = store.get().customRequests || [];
    const rows = status ? list.filter(r => r.status === status) : list;
    ok(res, rows.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
  });

  router.patch('/api/v1/admin/custom-requests/:id', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'orders:write');
    const db = store.get();
    const r = (db.customRequests || []).find(x => x.id === req.params.id);
    if (!r) throw E.notFound('Request not found.');
    const b = req.body || {};

    if (b.status != null) {
      const to = String(b.status);
      const allowed = CR_FLOW[r.status] || [];
      if (allowed.indexOf(to) < 0) {
        throw new ApiError(409, 'BAD_TRANSITION',
          'Cannot go from ' + r.status + ' to ' + to + '. Allowed: ' + (allowed.join(', ') || 'none') + '.');
      }
      r.prevStatus = r.status;
      r.status = to;
    }
    if (b.quote != null) r.quote = pricing.round2(Number(b.quote));
    if (b.note != null) r.note = String(b.note).slice(0, 600);
    r.updatedAt = new Date().toISOString();
    audit(me, 'custom.update', r.id, { status: r.status });
    store.flush();
    ok(res, { request: r });
  });

  /* ---------------- 内容（A-08 / FR-A-012） ----------------
     这一版能改的是「首页区块文案」和「8 个内容页的标题与导语」；
     正文段落仍在 app/web/assets/js/pages.js —— 不在这个模块假装能改，
     否则运营改完发现没生效，比没有这个入口更糟。 */
  router.get('/api/v1/admin/content', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'settings:write');
    const db = store.get();
    ok(res, {
      content: db.settings.content || {},
      brand: db.settings.brand,
      tagline: db.settings.tagline,
      pages: db.pages || {},
    });
  });

  router.patch('/api/v1/admin/content', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'settings:write');
    const db = store.get();
    const b = req.body || {};
    const before = JSON.parse(JSON.stringify({ content: db.settings.content, pages: db.pages || {} }));

    if (b.brand != null) db.settings.brand = String(b.brand).slice(0, 40);
    if (b.tagline != null) db.settings.tagline = String(b.tagline).slice(0, 80);
    if (b.content && typeof b.content === 'object') {
      ['announce', 'heroEyebrow', 'heroTitle', 'heroBody', 'bestSellersEyebrow']
        .forEach(k => {
          if (b.content[k] != null) db.settings.content[k] = String(b.content[k]).slice(0, 400);
        });
    }
    if (b.pages && typeof b.pages === 'object') {
      db.pages = db.pages || {};
      Object.keys(b.pages).forEach(slug => {
        const src = b.pages[slug] || {};
        const cur = db.pages[slug] || { slug };
        db.pages[slug] = {
          slug,
          title: src.title != null ? String(src.title).slice(0, 90) : cur.title,
          intro: src.intro != null ? String(src.intro).slice(0, 260) : cur.intro,
        };
      });
    }
    audit(me, 'content.update', 'storefront', { before });
    store.flush();
    ok(res, { content: db.settings.content, pages: db.pages || {} });
  });
}

module.exports = { routes, metrics, TRANSITIONS };
