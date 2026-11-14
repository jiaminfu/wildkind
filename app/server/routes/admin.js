/* ============================================================
   TIDEGLASS · 后台接口（全部需要 Bearer 令牌 + 权限位）
   路由前缀 /api/v1/admin/*；每个写操作都写 auditLog。
   ============================================================ */
'use strict';
const store = require('../lib/store');
const auth = require('../lib/auth');
const pricing = require('../lib/pricing');
const uploads = require('../lib/uploads');
const csv = require('../lib/csv');
const { E, ApiError, ok, rateLimit, clientIp, CORS } = require('../lib/http');
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

/* ============================================================
   商品写操作的共用规则
   新建与编辑走同一套校验，避免「新建能过、编辑不拦」这种口径分裂。
   ============================================================ */
const CATS = ['necklaces', 'bracelets', 'anklets', 'rings', 'hair'];
const METALS = ['Gold', 'Silver', 'Rose Gold'];
const BADGES = ['New', 'Bestseller'];
const MAX_IMAGES = 6;
const METAL_CODE = { Gold: 'GO', Silver: 'SI', 'Rose Gold': 'RO' };

function slugify(s) {
  return String(s || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function nextProductId(db) {
  let max = 100;
  (db.products || []).forEach(p => {
    const m = /^TG-(\d+)$/.exec(String(p.id));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'TG-' + (max + 1);
}

/* handle 是 URL 的一部分。改标题时如果顺手改了 handle，
   已经发出去的小红书/广告链接会全部 404，所以只在显式传入时才变。 */
function uniqueHandle(db, want, exceptId) {
  const base = slugify(want) || 'product';
  const taken = h => (db.products || []).some(p => p.id !== exceptId && (p.handle === h || p.id === h));
  let h = base;
  let n = 2;
  while (taken(h)) h = base + '-' + n++;
  return h;
}

function fieldError(field, message) {
  return E.badRequest(message, [{ field, message }]);
}

/* 变体：金属必须是固定三种，SKU 商品内唯一，缺 SKU 就按 TG-编号-金属码 自动生成。
   自由填金属会让前台筛选、库存报表按 metal 分组时出现 "gold" / "Gold " 这类脏数据。 */
function normalizeVariants(input, idNum, mainPrice, existing) {
  const list = Array.isArray(input) ? input : null;
  if (!list || !list.length) throw fieldError('variants', 'At least one variant is required.');
  if (list.length > 12) throw fieldError('variants', 'A product can hold at most 12 variants.');

  const oldBySku = {};
  (existing || []).forEach(v => { oldBySku[v.sku] = v; });
  const seen = new Set();

  return list.map((raw, i) => {
    const v = raw || {};
    const metal = METALS.find(m => m.toLowerCase() === String(v.metal || '').trim().toLowerCase());
    if (!metal) throw fieldError('variants.' + i + '.metal', 'Metal must be Gold, Silver or Rose Gold.');

    const stock = Math.floor(Number(v.stock));
    if (!Number.isFinite(stock) || stock < 0) {
      throw fieldError('variants.' + i + '.stock', 'Stock must be a non-negative integer.');
    }

    let price = v.price == null || v.price === '' ? mainPrice : pricing.round2(Number(v.price));
    if (!Number.isFinite(price) || price <= 0) {
      throw fieldError('variants.' + i + '.price', 'Variant price must be greater than 0.');
    }

    let sku = String(v.sku || '').trim().toUpperCase();
    if (!sku) sku = 'TG-' + idNum + '-' + METAL_CODE[metal];
    if (!/^[A-Z0-9-]{3,32}$/.test(sku)) {
      throw fieldError('variants.' + i + '.sku', 'SKU must be 3–32 chars, letters/numbers/hyphen.');
    }
    if (seen.has(sku)) throw fieldError('variants.' + i + '.sku', 'Duplicate SKU ' + sku + '.');
    seen.add(sku);

    const prev = oldBySku[sku];
    return { sku, metal, price, stock, _prevStock: prev ? prev.stock : null };
  });
}

/* 库存流水：数字变化必须留痕。只改汇总值不写流水，三个月后就对不上账了。 */
function writeLedger(db, productId, v, delta, reason, staffId) {
  db.stockLedger.push({
    id: 'L' + Math.random().toString(36).slice(2, 10),
    sku: v.sku,
    productId,
    delta,
    reason: reason || 'manual',
    refType: 'manual',
    refId: staffId || null,
    balanceAfter: v.stock,
    createdAt: new Date().toISOString(),
  });
}

function syncTotalStock(p) {
  p.stock = (p.variants || []).reduce((a, v) => a + (v.stock || 0), 0);
}

function normalizeImages(input) {
  const list = Array.isArray(input) ? input : null;
  if (!list) return null;
  /* 允许空数组：草稿可以先没有图，先建好再补拍。
     真正拦在 guardPublish——没图的商品不许上架。 */
  if (list.length > MAX_IMAGES) throw fieldError('images', 'At most ' + MAX_IMAGES + ' images.');
  return list.map((s, i) => {
    const v = String(s || '').trim().replace(/^\/+/, '');
    if (!v) throw fieldError('images.' + i, 'Image path is empty.');
    const okPath = /^uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v) || /^assets\/img\/[A-Za-z0-9/._-]+$/.test(v);
    if (!okPath) throw fieldError('images.' + i, 'Image must be an uploads/ or assets/img/ path.');
    return v;
  });
}

function normDetails(d) {
  const out = {};
  if (!d || typeof d !== 'object') return out;
  ['material', 'pendant', 'chain', 'weight'].forEach(k => {
    if (d[k] != null && String(d[k]).trim()) out[k] = String(d[k]).trim().slice(0, 120);
  });
  return out;
}

function normSizes(list) {
  if (!Array.isArray(list)) return [];
  return list.map(csv.normalizeSize).filter(Boolean).slice(0, 5).map(s => s.slice(0, 12));
}

function normCollections(db, list) {
  if (!Array.isArray(list)) return [];
  const known = new Set((db.collections || []).map(c => c.handle));
  return list.map(String).filter(h => known.has(h)).slice(0, 12);
}

/* 成本价只对 owner 可见。
   注意这里不能只在列表接口挡：写接口如果原样回吐 product，ops 调一次 PATCH 就拿到 cost 了。 */
function forStaff(p, me) {
  if (me && me.role === 'owner') return p;
  return Object.assign({}, p, { cost: null });
}

/* 报错信息也会漏成本：ops 改价撞到低于成本时，
   原文案 "below unit cost $19.50" 等于把成本报给了他。 */
function belowCostMsg(me, price, cost) {
  if (me && me.role === 'owner') {
    return 'Price $' + Number(price).toFixed(2) + ' is below unit cost $' + Number(cost).toFixed(2) + '.';
  }
  return 'Price is below the recorded unit cost.';
}

/* 上架前置条件：没图、没价、没库存的商品挂到前台，
   顾客看到的是裂图和「售罄」，比不出现更伤。 */
function guardPublish(p) {
  if (!(p.images || []).length) {
    throw E.unprocessable('NEEDS_IMAGE', 'Add at least one image before publishing.');
  }
  if (!p.variants || !p.variants.length) {
    throw E.unprocessable('NEEDS_VARIANT', 'Add at least one variant before publishing.');
  }
  if (!(p.price > 0)) {
    throw E.unprocessable('NEEDS_PRICE', 'Set a price before publishing.');
  }
}

/* ============================================================
   CSV 导入：按 group 归并，一行 = 一个变体
   同一 group 的行合成一个商品的多个变体——一个颜色一行，
   店主在 Excel 里看着直观，也不用手写嵌套结构。
   ============================================================ */
const CSV_REQUIRED = ['group', 'title', 'category', 'price', 'metal', 'stock'];
const IMG_RE = /^(?:uploads\/[A-Za-z0-9][A-Za-z0-9._-]*|assets\/img\/[A-Za-z0-9/._-]+)$/;

function buildImport(db, text) {
  const errors = [];
  const warnings = [];

  const sheet = csv.parse(text);
  if (!sheet.length) throw E.badRequest('CSV is empty.');
  const header = sheet[0].map(h => String(h).trim().toLowerCase());
  const missing = CSV_REQUIRED.filter(k => header.indexOf(k) < 0);
  if (missing.length) {
    throw E.badRequest('CSV is missing column(s): ' + missing.join(', ') + '.', [
      { field: 'csv', message: 'Missing ' + missing.join(', ') },
    ]);
  }

  const totalRows = Math.max(0, sheet.length - 1);
  const order = [];
  const buckets = {};
  for (let i = 1; i < sheet.length; i++) {
    const cells = sheet[i];
    if (!cells.some(c => String(c).trim())) continue;
    const map = {};
    header.forEach((h, j) => { map[h] = String(cells[j] == null ? '' : cells[j]).trim(); });
    const key = map.group;
    if (!key) { errors.push({ line: i + 1, column: 'group', message: 'group is required.' }); continue; }
    if (!buckets[key]) { buckets[key] = []; order.push(key); }
    buckets[key].push({ line: i + 1, map });
  }

  const existingSkus = new Set();
  (db.products || []).forEach(p => (p.variants || []).forEach(v => existingSkus.add(v.sku)));
  const existingHandles = new Set((db.products || []).map(p => p.handle));
  const importSkus = new Set();
  const importHandles = new Set();
  const knownCollections = new Set((db.collections || []).map(c => c.handle));

  const groups = order.map(key => {
    const lines = buckets[key];
    const head = lines[0].map;
    const g = {
      key, line: lines[0].line, ok: true,
      title: head.title || '',
      handle: String(head.handle || '').toLowerCase(),
      cat: String(head.category || '').toLowerCase(),
      price: head.price === '' ? NaN : Number(head.price),
      cost: head.cost === undefined || head.cost === '' ? 0 : Number(head.cost),
      compareAt: !head.compareat ? null : Number(head.compareat),
      desc: (head.desc || '').slice(0, 2000),
      motif: (head.motif || '').slice(0, 40),
      set: (head.set || '').slice(0, 40),
      badge: head.badge || '',
      images: [], sizes: [], collections: [], variants: [],
    };
    const bad = (line, column, message) => { g.ok = false; errors.push({ line, column, message }); };

    if (!g.title) bad(g.line, 'title', 'title is required.');
    if (CATS.indexOf(g.cat) < 0) bad(g.line, 'category', 'category must be one of ' + CATS.join(', ') + '.');
    if (!Number.isFinite(g.price) || g.price <= 0) bad(g.line, 'price', 'price must be greater than 0.');
    if (!Number.isFinite(g.cost) || g.cost < 0) bad(g.line, 'cost', 'cost must be 0 or more.');
    else if (Number.isFinite(g.price) && g.cost > g.price) bad(g.line, 'cost', 'cost is above the selling price.');
    if (g.compareAt != null && (!Number.isFinite(g.compareAt) || g.compareAt <= g.price)) {
      bad(g.line, 'compareAt', 'compareAt must be higher than price.');
    }

    /* 显式写的 handle 撞了直接报错（说明他填错了别的东西），
       由标题自动生成的撞了就加后缀——人根本没打算指定 URL。 */
    const wanted = g.handle || slugify(g.title);
    if (!wanted) {
      bad(g.line, 'handle', 'Cannot build a handle from this title; fill the handle column.');
    } else if (existingHandles.has(wanted) || importHandles.has(wanted)) {
      if (g.handle) {
        bad(g.line, 'handle', 'handle "' + wanted + '" already exists.');
      } else {
        let n = 2;
        let h = wanted;
        while (existingHandles.has(h) || importHandles.has(h)) h = wanted + '-' + n++;
        g.handle = h;
        importHandles.add(h);
      }
    } else {
      g.handle = wanted;
      importHandles.add(wanted);
    }

    if (head.images) {
      const arr = head.images.split('|').map(s => s.trim().replace(/^\/+/, '')).filter(Boolean);
      if (arr.length > MAX_IMAGES) bad(g.line, 'images', 'at most ' + MAX_IMAGES + ' images.');
      const good = arr.filter(s => IMG_RE.test(s));
      if (good.length !== arr.length) {
        bad(g.line, 'images', 'image paths must start with uploads/ or assets/img/.');
      }
      g.images = good.slice(0, MAX_IMAGES);
    }
    if (head.sizes) {
      g.sizes = head.sizes.split('|').map(csv.normalizeSize).filter(Boolean).slice(0, 5);
    }
    if (head.collections) {
      const arr = head.collections.split('|').map(s => s.trim()).filter(Boolean);
      const unknown = arr.filter(h => !knownCollections.has(h));
      if (unknown.length) {
        warnings.push({ line: g.line, column: 'collections', message: 'unknown collection(s) skipped: ' + unknown.join(', ') });
      }
      g.collections = arr.filter(h => knownCollections.has(h));
    }
    if (g.badge && BADGES.indexOf(g.badge) < 0) {
      warnings.push({ line: g.line, column: 'badge', message: 'unknown badge "' + g.badge + '" ignored.' });
    }

    lines.forEach(r => {
      const m = r.map;
      const metal = METALS.find(x => x.toLowerCase() === String(m.metal || '').toLowerCase());
      if (!metal) return bad(r.line, 'metal', 'metal must be Gold, Silver or Rose Gold.');

      const stock = m.stock === '' ? NaN : Number(m.stock);
      if (!Number.isInteger(stock) || stock < 0) {
        return bad(r.line, 'stock', 'stock must be a non-negative integer.');
      }

      const vpRaw = m.variantprice;
      const vp = vpRaw === undefined || vpRaw === '' ? null : Number(vpRaw);
      if (vp != null && (!Number.isFinite(vp) || vp <= 0)) {
        return bad(r.line, 'variantPrice', 'variantPrice must be greater than 0.');
      }

      let sku = String(m.sku || '').trim().toUpperCase();
      if (sku && !/^[A-Z0-9-]{3,32}$/.test(sku)) {
        return bad(r.line, 'sku', 'sku must be 3–32 chars, A-Z / 0-9 / hyphen.');
      }
      if (sku && (existingSkus.has(sku) || importSkus.has(sku))) {
        return bad(r.line, 'sku', 'sku "' + sku + '" already exists.');
      }
      if (sku) importSkus.add(sku);
      g.variants.push({ metal, stock, sku, price: vp });
    });

    if (!g.variants.length) bad(g.line, 'metal', 'at least one valid variant is required.');
    return g;
  });

  return { totalRows, groups, errors, warnings, existingSkus };
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
    // 按时间倒序：真实下单是 unshift（新单在数组头），但演示数据的日期是打散的，
    // 不排序的话列表看起来是乱的。统一按 createdAt 倒序，谁看都是"最近的在上"。
    let list = db.orders.slice().sort((a, b) =>
      String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
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
      compareAt: p.compareAt || null,
      // 成本只给 owner。ops 拿不到成本，利润看板也会跟着留空，不是 bug。
      cost: me.role === 'owner' ? (p.cost || 0) : null,
      stock: pricing.totalStock(p), active: !!p.active,
      badge: p.badge || null, category: p.cat,
      image: (p.images || [])[0] || null,
      variants: (p.variants || []).map(v => ({ sku: v.sku, metal: v.metal, stock: v.stock, price: v.price })),
      updatedAt: p.updatedAt, version: p.version,
    })));
  });

  /* 编辑抽屉要一次性拿到全部字段，否则打开抽屉还得二次请求 */
  router.get('/api/v1/admin/products/:id', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:read');
    const db = store.get();
    const p = pricing.findProduct(db, req.params.id);
    if (!p) throw E.notFound('Product not found.');
    ok(res, {
      id: p.id, handle: p.handle, title: p.title, desc: p.desc || '',
      cat: p.cat, motif: p.motif || '', set: p.set || '',
      price: p.price, cost: me.role === 'owner' ? (p.cost || 0) : null,
      compareAt: p.compareAt || null, badge: p.badge || null,
      images: (p.images || []).slice(), sizes: (p.sizes || []).slice(),
      collections: (p.collections || []).slice(), details: p.details || {},
      variants: (p.variants || []).map(v => ({ sku: v.sku, metal: v.metal, price: v.price, stock: v.stock })),
      active: !!p.active, stock: pricing.totalStock(p),
      version: p.version, createdAt: p.createdAt || null, updatedAt: p.updatedAt || null,
    });
  });

  /* 新建：默认草稿（active=false），填完再手动上架。
     直接上架的话，填一半、没图、库存还没核对的商品会立刻出现在前台并被下单。 */
  router.post('/api/v1/admin/products', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:write');
    const db = store.get();
    const b = req.body || {};

    const title = String(b.title || '').trim();
    if (!title) throw fieldError('title', 'Title is required.');
    if (title.length > 120) throw fieldError('title', 'Title must be 120 characters or fewer.');

    const cat = String(b.cat || '').trim().toLowerCase();
    if (CATS.indexOf(cat) < 0) throw fieldError('cat', 'Category must be one of ' + CATS.join(', ') + '.');

    const price = pricing.round2(Number(b.price));
    if (!Number.isFinite(price) || price <= 0) throw fieldError('price', 'Price must be greater than 0.');

    if (b.cost != null && b.cost !== '' && me.role !== 'owner') {
      throw E.forbidden('Only the store owner can set the cost price.');
    }
    const cost = b.cost == null || b.cost === '' ? 0 : pricing.round2(Number(b.cost));
    if (!Number.isFinite(cost) || cost < 0) throw fieldError('cost', 'Cost must be 0 or more.');
    if (cost > price) {
      throw E.unprocessable('PRICE_BELOW_COST', belowCostMsg(me, price, cost));
    }

    let compareAt = null;
    if (b.compareAt != null && b.compareAt !== '') {
      compareAt = pricing.round2(Number(b.compareAt));
      if (!Number.isFinite(compareAt) || compareAt <= price) {
        throw fieldError('compareAt', 'Compare-at price must be higher than the selling price.');
      }
    }

    const id = nextProductId(db);
    const idNum = Number(id.split('-')[1]);
    const handle = uniqueHandle(db, b.handle || title, null);
    const variants = normalizeVariants(b.variants, idNum, price, []);
    const images = normalizeImages(b.images) || [];

    const now = new Date().toISOString();
    const p = {
      id, handle, title,
      desc: String(b.desc || '').slice(0, 2000),
      cat,
      motif: String(b.motif || '').trim().slice(0, 40),
      set: String(b.set || '').trim().slice(0, 40),
      price, compareAt, cost,
      badge: BADGES.indexOf(b.badge) >= 0 ? b.badge : null,
      currency: 'USD',
      images,
      sizes: normSizes(b.sizes),
      collections: normCollections(db, b.collections),
      details: normDetails(b.details),
      variants: variants.map(v => ({ sku: v.sku, metal: v.metal, price: v.price, stock: v.stock })),
      rating: 0, reviewCount: 0, sold30: 0,
      active: false,
      version: 1,
      createdAt: now, updatedAt: now,
    };
    syncTotalStock(p);

    db.products.push(p);
    p.variants.forEach(v => writeLedger(db, p.id, v, v.stock, 'initial', me.staffId));
    audit(me, 'product.create', p.id, { title: p.title, price: p.price, cost: p.cost, active: false });
    store.flush();
    ok(res, { product: forStaff(p, me) }, 201);
  });

  /* 复制：新品上架时同系列改个图案就能复用，比从头填快得多。
     库存归零——复制出来的库存是账面数字，不能凭空变成可售。 */
  router.post('/api/v1/admin/products/:id/duplicate', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:write');
    const db = store.get();
    const src = pricing.findProduct(db, req.params.id);
    if (!src) throw E.notFound('Product not found.');

    const id = nextProductId(db);
    const idNum = Number(id.split('-')[1]);
    const handle = uniqueHandle(db, src.handle + '-copy', null);
    const now = new Date().toISOString();
    const p = JSON.parse(JSON.stringify(src));
    p.id = id;
    p.handle = handle;
    p.title = String(src.title).slice(0, 110) + ' (copy)';
    p.variants = (src.variants || []).map(v => ({
      sku: 'TG-' + idNum + '-' + METAL_CODE[v.metal] || v.sku,
      metal: v.metal, price: v.price, stock: 0,
    }));
    p.images = (src.images || []).slice();
    p.active = false;
    p.version = 1;
    p.rating = 0; p.reviewCount = 0; p.sold30 = 0;
    p.createdAt = now; p.updatedAt = now;
    syncTotalStock(p);
    db.products.push(p);
    audit(me, 'product.duplicate', p.id, { from: src.id });
    store.flush();
    ok(res, { product: forStaff(p, me) }, 201);
  });

  /* 删除：有订单引用就只许下架。
     硬删会让历史订单的商品名变空、对账断链，宁可挡住。 */
  router.delete('/api/v1/admin/products/:id', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:write');
    const db = store.get();
    const p = pricing.findProduct(db, req.params.id);
    if (!p) throw E.notFound('Product not found.');

    const used = db.orders.filter(o => (o.items || []).some(i => i.productId === p.id)).length;
    if (used) {
      throw E.conflict('This product appears in ' + used + ' order(s). Unlist it instead of deleting.',
        { orders: used });
    }

    db.products = db.products.filter(x => x.id !== p.id);
    audit(me, 'product.delete', p.id, { title: p.title });
    store.flush();
    ok(res, { deleted: p.id });
  });

  /* 图片上传：前端 Canvas 压到最长边 1600px / q0.82 后转 base64，
     服务端只做格式与体积校验，落盘到数据卷。 */
  router.post('/api/v1/admin/uploads', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:write');
    const b = req.body || {};
    if (!b.dataUrl) throw fieldError('dataUrl', 'No image data received.');
    const saved = uploads.saveDataUrl(b.dataUrl);
    audit(me, 'upload.image', saved.file, { bytes: saved.bytes });
    ok(res, { path: saved.path, file: saved.file, bytes: saved.bytes }, 201);
  });

  /* ---------------- CSV 批量导入 ----------------
     两段式：先 preview 全量校验、一行不写库；店主看过结果再 confirm。
     一次性导入 100 行，中途失败一半而库里留下 50 个半成品，是最难收拾的场面。 */
  router.post('/api/v1/admin/products/import/preview', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:write');
    const parsed = buildImport(store.get(), String((req.body || {}).csv || ''));
    ok(res, {
      totalRows: parsed.totalRows,
      groupCount: parsed.groups.length,
      validGroups: parsed.groups.filter(g => g.ok).length,
      errorCount: parsed.errors.length,
      errors: parsed.errors.slice(0, 200),
      warnings: parsed.warnings.slice(0, 100),
      groups: parsed.groups.map(g => ({
        key: g.key, title: g.title, category: g.cat, price: g.price,
        variants: g.variants.length,
        stock: g.variants.reduce((a, v) => a + v.stock, 0),
        handle: g.handle, ok: g.ok,
      })),
    });
  });

  router.post('/api/v1/admin/products/import', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:write');
    const db = store.get();
    const b = req.body || {};
    const mode = b.mode === 'valid-only' ? 'valid-only' : 'abort';
    const parsed = buildImport(db, String(b.csv || ''));

    if (parsed.errors.length && mode === 'abort') {
      throw new ApiError(422, 'IMPORT_HAS_ERRORS',
        parsed.errors.length + ' row(s) failed validation. Fix them or choose "import valid rows only".',
        { errors: parsed.errors.slice(0, 200), validGroups: parsed.groups.filter(g => g.ok).length });
    }

    const usable = parsed.groups.filter(g => g.ok);
    if (!usable.length) throw E.badRequest('Nothing to import — no valid rows.');

    const created = store.tx(() => {
      const out = [];
      usable.forEach(g => {
        const id = nextProductId(db);
        const idNum = Number(id.split('-')[1]);
        const now = new Date().toISOString();
        const variants = g.variants.map(v => {
          let sku = String(v.sku || '').trim().toUpperCase();
          if (!sku) sku = 'TG-' + idNum + '-' + METAL_CODE[v.metal];
          return {
            sku,
            metal: v.metal,
            price: v.price ? pricing.round2(Number(v.price)) : g.price,
            stock: v.stock,
          };
        });
        const p = {
          id,
          handle: g.handle || uniqueHandle(db, g.key, null),
          title: g.title,
          desc: g.desc || '',
          cat: g.cat,
          motif: g.motif || '',
          set: g.set || '',
          price: g.price,
          compareAt: g.compareAt || null,
          cost: g.cost || 0,
          badge: BADGES.indexOf(g.badge) >= 0 ? g.badge : null,
          currency: 'USD',
          images: g.images || [],
          sizes: g.sizes || [],
          collections: normCollections(db, g.collections || []),
          details: {},
          variants,
          rating: 0, reviewCount: 0, sold30: 0,
          active: false,
          version: 1,
          createdAt: now, updatedAt: now,
        };
        syncTotalStock(p);
        db.products.push(p);
        p.variants.forEach(v => writeLedger(db, p.id, v, v.stock, 'import', me.staffId));
        out.push({ id: p.id, handle: p.handle, title: p.title, variants: p.variants.length, stock: p.stock });
      });
      audit(me, 'product.import', null, { created: out.length, skipped: parsed.groups.length - out.length });
      return out;
    });

    ok(res, {
      created: created.length,
      skipped: parsed.groups.length - created.length,
      products: created,
      errors: parsed.errors.slice(0, 200),
    }, 201);
  });

  router.get('/api/v1/admin/products/import/template', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'products:write');
    const body = csv.template();
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="tideglass-products-template.csv"',
      'Content-Length': Buffer.byteLength(body, 'utf8'),
      ...CORS,
    });
    res.end(body);
  });

  /* 编辑：一个接口覆盖所有字段，前端抽屉保存时整包提交。
     version 用作乐观锁——两个人同时开着同一个商品改价，后保存的会被挡住。 */
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

    /* handle 只在显式传入时才变。改标题顺手改 URL，
       等于把已经投放出去的链接全部打断成 404。 */
    if (b.handle != null && String(b.handle).trim()) {
      const want = slugify(b.handle);
      if (!want) throw fieldError('handle', 'Handle may only contain letters, numbers and hyphens.');
      if (want !== p.handle) {
        const clash = db.products.some(x => x.id !== p.id && (x.handle === want || x.id === want));
        if (clash) throw fieldError('handle', 'Handle "' + want + '" is already taken.');
        p.handle = want;
      }
    }

    if (b.title != null) {
      const t = String(b.title).trim();
      if (!t) throw fieldError('title', 'Title cannot be empty.');
      p.title = t.slice(0, 120);
    }
    if (b.desc != null) p.desc = String(b.desc).slice(0, 2000);
    if (b.cat != null) {
      const c = String(b.cat).trim().toLowerCase();
      if (CATS.indexOf(c) < 0) throw fieldError('cat', 'Category must be one of ' + CATS.join(', ') + '.');
      p.cat = c;
    }
    if (b.motif != null) p.motif = String(b.motif).trim().slice(0, 40);
    if (b.set != null) p.set = String(b.set).trim().slice(0, 40);
    if (b.badge !== undefined) p.badge = BADGES.indexOf(b.badge) >= 0 ? b.badge : null;
    if (b.details != null) p.details = normDetails(b.details);
    if (b.sizes != null) p.sizes = normSizes(b.sizes);
    /* 挂载集合：只接受库里真实存在的 handle，别让手滑的拼写产生"看不见的集合" */
    if (Array.isArray(b.collections)) p.collections = normCollections(db, b.collections);
    if (b.images !== undefined) {
      const imgs = normalizeImages(b.images);
      p.images = imgs || [];
    }

    if (b.price != null) {
      const np = Number(b.price);
      if (!Number.isFinite(np) || np <= 0) {
        throw fieldError('price', 'Price must be greater than 0.');
      }
      if (np < (p.cost || 0)) {
        throw E.unprocessable('PRICE_BELOW_COST', belowCostMsg(me, np, p.cost || 0));
      }
      // 变体价按原比例跟随，保住 Rose Gold 之类的溢价关系；
      // 但如果这次同时提交了变体表，就按变体表里的显式价来，不再二次缩放。
      const oldPrice = p.price;
      p.price = pricing.round2(np);
      if (!Array.isArray(b.variants) && oldPrice > 0) {
        (p.variants || []).forEach(v => {
          v.price = pricing.round2(np * (v.price / oldPrice));
        });
      }
    }
    if (b.cost != null) {
      /* 成本影响毛利报表，只有 owner 能改。
         ops 能改价但看不到成本，如果还允许他写成本，等于让他盲改利润口径。 */
      if (me.role !== 'owner') throw E.forbidden('Only the store owner can change cost price.');
      const nc = pricing.round2(Number(b.cost));
      if (!Number.isFinite(nc) || nc < 0) throw fieldError('cost', 'Cost must be 0 or more.');
      if (nc > p.price) {
        throw E.unprocessable('PRICE_BELOW_COST',
          'Cost $' + nc.toFixed(2) + ' is above the selling price $' + p.price.toFixed(2) + '.');
      }
      p.cost = nc;
    }
    if (b.compareAt !== undefined) {
      if (b.compareAt === null || b.compareAt === '') p.compareAt = null;
      else {
        const ca = pricing.round2(Number(b.compareAt));
        if (!Number.isFinite(ca) || ca <= p.price) {
          throw fieldError('compareAt', 'Compare-at price must be higher than the selling price.');
        }
        p.compareAt = ca;
      }
    }

    /* 变体表：整表替换。库存差写流水，新增变体记 variant-add。 */
    if (Array.isArray(b.variants)) {
      const idNum = Number(String(p.id).replace(/\D/g, '')) || 0;
      const list = normalizeVariants(b.variants, idNum, p.price, p.variants || []);
      const beforeMap = {};
      (p.variants || []).forEach(v => { beforeMap[v.sku] = v; });
      p.variants = list.map(v => ({ sku: v.sku, metal: v.metal, price: v.price, stock: v.stock }));
      p.variants.forEach(v => {
        const prev = beforeMap[v.sku];
        const delta = v.stock - (prev ? prev.stock : 0);
        if (delta !== 0) {
          writeLedger(db, p.id, v, delta, prev ? 'variant-adjust' : 'variant-add', me.staffId);
        }
      });
      syncTotalStock(p);
    }

    if (b.active != null) {
      const want = !!b.active;
      if (want && !p.active) guardPublish(p);   // 只有从草稿转上架才挡，已经在架上的编辑不拦
      p.active = want;
    }

    p.updatedAt = new Date().toISOString();
    p.version = (p.version || 1) + 1;
    audit(me, 'product.update', p.id, { before, after: { price: p.price, cost: p.cost, active: p.active } });
    store.flush();
    ok(res, { product: forStaff(p, me) });
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
