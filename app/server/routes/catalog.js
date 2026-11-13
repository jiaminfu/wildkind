/* ============================================================
   TIDEGLASS · 公开目录接口（无需登录）
   ============================================================ */
'use strict';
const store = require('../lib/store');
const { E, ok, rateLimit, clientIp } = require('../lib/http');
const pricing = require('../lib/pricing');

const PRICE_BANDS = {
  'under-70': p => p.price < 70,
  '70-100': p => p.price >= 70 && p.price <= 100,
  'over-100': p => p.price > 100,
};

const SORTS = {
  featured: (a, b) => (b.badge ? 1 : 0) - (a.badge ? 1 : 0) || b.rating - a.rating,
  new: (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
  best: (a, b) => (b.sold30 || 0) - (a.sold30 || 0),
  'price-asc': (a, b) => a.price - b.price,
  'price-desc': (a, b) => b.price - a.price,
  rating: (a, b) => b.rating - a.rating,
};

/* 对外只暴露可售字段；成本、供应商、内部备注不出门 */
function publicProduct(p) {
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    price: p.price,
    compareAt: p.compareAt || null,
    currency: 'USD',
    images: p.images || [],
    motif: p.motif || '',
    set: p.set || '',
    category: p.cat || '',
    badge: p.badge || null,
    rating: p.rating || 0,
    reviewCount: p.reviewCount || 0,
    description: p.desc || '',
    details: p.details || {},
    sizes: p.sizes || [],
    collections: p.collections || [],
    inStock: pricing.totalStock(p) > 0,
    totalStock: pricing.totalStock(p),
    variants: (p.variants || []).map(v => ({
      sku: v.sku,
      metal: v.metal,
      price: v.price,
      inStock: v.stock > 0,
      stock: v.stock,          // 前端显示「仅剩 N 件」需要精确值
    })),
    createdAt: p.createdAt || null,
  };
}

function publicCollection(c, db) {
  const count = db.products.filter(p => p.active && (p.collections || []).indexOf(c.handle) >= 0).length;
  return {
    handle: c.handle, title: c.title, level: c.level || 1,
    parent: c.parent || null, menuGroup: c.menuGroup || null,
    nav: !!c.nav, visible: c.visible !== false,
    order: c.order || 0, intro: c.intro || '', count,
  };
}

function listProducts(q) {
  const db = store.get();
  let list = db.products.filter(p => p.active);

  if (q.collection) list = list.filter(p => (p.collections || []).indexOf(q.collection) >= 0);
  if (q.metal) list = list.filter(p => (p.variants || []).some(v => v.metal === q.metal && v.stock > 0));
  if (q.price && PRICE_BANDS[q.price]) list = list.filter(PRICE_BANDS[q.price]);
  if (q.stock === 'in') list = list.filter(p => pricing.totalStock(p) > 0);
  if (q.motif) list = list.filter(p => p.motif === q.motif);
  if (q.q) {
    const needle = String(q.q).toLowerCase();
    list = list.filter(p =>
      (p.title + ' ' + p.desc + ' ' + (p.motif || '') + ' ' + (p.collections || []).join(' '))
        .toLowerCase().indexOf(needle) >= 0);
  }

  const sortFn = SORTS[q.sort] || SORTS.featured;
  list = list.slice().sort(sortFn);

  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(48, Math.max(1, parseInt(q.limit, 10) || 24));
  const total = list.length;
  const items = list.slice((page - 1) * limit, page * limit).map(publicProduct);

  return { items, page, limit, total, hasMore: page * limit < total };
}

function routes(router) {
  router.get('/api/v1/health', (req, res) => {
    const db = store.get();
    ok(res, {
      status: 'ok',
      version: db.meta.version,
      products: db.products.length,
      orders: db.orders.length,
      time: new Date().toISOString(),
    });
  });

  /* 首屏一次性拿全：设置 + 导航 + 集合 + 赠品规则。
     单次请求换掉 4 个串行请求，弱网下首屏快一档。 */
  router.get('/api/v1/bootstrap', (req, res) => {
    const db = store.get();
    ok(res, {
      settings: {
        brand: db.settings.brand,
        tagline: db.settings.tagline,
        currency: db.settings.currency,
        freeShippingThreshold: db.settings.freeShip,
        standardShipping: db.settings.standardShip,
        expressShipping: db.settings.expressShip,
        giftThreshold: db.giftRule ? db.giftRule.threshold : null,
        giftName: db.giftRule ? db.giftRule.name : null,
        announce: (db.settings.content || {}).announce || '',
        heroEyebrow: (db.settings.content || {}).heroEyebrow || '',
        heroTitle: (db.settings.content || {}).heroTitle || '',
        heroBody: (db.settings.content || {}).heroBody || '',
        bestSellersEyebrow: (db.settings.content || {}).bestSellersEyebrow || 'As seen on TikTok',
        storeOpen: db.settings.storeOpen !== false,
        returnWindowDays: db.settings.returnWindowDays || 30,
      },
      /* 内容页标题与导语：后台 A-08 改完这里立刻变，正文仍在 pages.js */
      pages: db.pages || {},
      collections: db.collections.filter(c => c.visible !== false).map(c => publicCollection(c, db)),
      nav: db.collections
        .filter(c => c.nav && c.level === 1 && c.visible !== false)
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(c => ({ handle: c.handle, title: c.title })),
      giftRule: db.giftRule,
    });
  });

  router.get('/api/v1/products', (req, res) => {
    const out = listProducts(req.query);
    ok(res, out.items, 200);
  });

  /* 带分页元信息的版本，后台与管理台用 */
  router.get('/api/v1/products/search', (req, res) => {
    const out = listProducts(req.query);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ data: out.items, meta: { page: out.page, limit: out.limit, total: out.total, hasMore: out.hasMore } }));
  });

  router.get('/api/v1/products/:handle', (req, res) => {
    const db = store.get();
    const p = pricing.findProduct(db, req.params.handle);
    if (!p || !p.active) throw E.notFound('That product is not available.');
    const related = db.products
      .filter(x => x.active && x.id !== p.id && (x.collections || []).some(c => (p.collections || []).includes(c)))
      .slice(0, 4)
      .map(x => ({ id: x.id, handle: x.handle, title: x.title, price: x.price, image: (x.images || [])[0] }));
    ok(res, {
      product: publicProduct(p),
      reviews: db.reviews
        .filter(r => r.productId === p.id && r.status === 'approved')
        .slice(0, 8)
        .map(r => ({
          id: r.id, name: r.name, rating: r.rating, title: r.title,
          body: r.body, createdAt: r.createdAt, verified: !!r.verified,
        })),
      related,
    });
  });

  router.get('/api/v1/collections', (req, res) => {
    const db = store.get();
    ok(res, db.collections.filter(c => c.visible !== false).map(c => publicCollection(c, db)));
  });

  router.get('/api/v1/collections/:handle', (req, res) => {
    const db = store.get();
    const c = db.collections.find(x => x.handle === req.params.handle);
    if (!c) throw E.notFound('That collection does not exist.');
    const out = listProducts(Object.assign({}, req.query, { collection: c.handle }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      data: out.items,
      meta: { collection: publicCollection(c, db), page: out.page, limit: out.limit, total: out.total, hasMore: out.hasMore },
    }));
  });

  router.get('/api/v1/search', (req, res) => {
    const out = listProducts({ q: req.query.q, sort: req.query.sort, limit: req.query.limit });
    ok(res, out.items);
  });

  /* ---------------- 定制需求单（前台 FR-S-092 → 后台 A-12） ----------------
     公开端点，不需要登录，所以必须限流：这是唯一一个可以把内容写进库的匿名入口。
     必填只留邮箱和需求描述——定制单的价值在于线索，字段越少交得越多；
     款式、数量、期望交期都可以后补。 */
  router.post('/api/v1/custom-requests', (req, res) => {
    rateLimit('custom:' + clientIp(req), 6, 10 * 60 * 1000);
    const db = store.get();
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const notes = String(b.notes || '').trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      throw E.badRequest('A valid email is required.', [{ field: 'email', message: 'Invalid email.' }]);
    }
    if (notes.length < 10) {
      throw E.badRequest('Tell us a little more about the piece (at least 10 characters).',
        [{ field: 'notes', message: 'Too short.' }]);
    }

    db.customRequests = db.customRequests || [];
    db.sequences = db.sequences || {};
    db.sequences.custom = (db.sequences.custom || 1000) + 1;

    const refs = Array.isArray(b.refUrls)
      ? b.refUrls.map(u => String(u).trim()).filter(u => /^https?:\/\//i.test(u)).slice(0, 5)
      : [];

    const rec = {
      id: 'CR' + db.sequences.custom,
      name: String(b.name || '').trim().slice(0, 80),
      email,
      style: String(b.style || '').trim().slice(0, 120),
      qty: Math.max(1, Math.min(500, Number(b.qty) || 1)),
      dueDate: b.dueDate ? String(b.dueDate).slice(0, 10) : null,
      notes: notes.slice(0, 1200),
      refUrls: refs,
      status: 'new',
      note: null,
      quote: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.customRequests.unshift(rec);
    store.flush();
    ok(res, { request: { id: rec.id, status: rec.status, createdAt: rec.createdAt } }, 201);
  });
}

module.exports = { routes, publicProduct, publicCollection, listProducts };
